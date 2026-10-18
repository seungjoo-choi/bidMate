import { resolveRecipients } from '../../core/recipients/resolve';
import { renderMail } from '../../core/templates/render';
import type { Group } from '../../core/types/recipient';
import type { DraftAttachment, MailDraft } from '../../core/types/mail';
import type { Notice } from '../../core/types/notice';
import type { FileMeta } from '../../messaging/protocol';
import { listRecipients } from '../config/recipients-api';
import { listTemplates } from '../config/templates-api';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from '../notices/notice-store';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface MailOpts { now?: () => Date; isBusy?: (noticeId: string) => boolean }

export const draftPath = (folder: string): string => `${folder}/mail-draft.json`;

/** 초안을 읽는다. 없거나 손상되면 null. 권한 오류만 던진다. */
async function readDraft(store: IFileStore, folder: string): Promise<MailDraft | null> {
  try {
    const d = await readJson<MailDraft>(store, draftPath(folder));
    if (d && typeof d === 'object' && d.schemaVersion === 1 && Array.isArray(d.to) && Array.isArray(d.cc)
      && Array.isArray(d.attachments) && typeof d.subject === 'string' && typeof d.html === 'string') return d;
    return null;
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION') throw e;
    return null;
  }
}

export async function getDraft(store: IFileStore, noticeId: string): Promise<MailDraft | null> {
  const notice = await new NoticeStore(store).loadNotice(noticeId);
  if (!notice) return null;
  return readDraft(store, notice.folder);
}

/**
 * 메일 초안을 만들어 `<folder>/mail-draft.json`에 쓰고 notice.mail을 갱신한다.
 * 공고 락 안에서 notice를 다시 읽고, config 락은 잡지 않은 채 저장한다(락 안이라 saveNotice를 직접 쓴다).
 */
export async function prepareMail(
  store: IFileStore, p: { noticeId: string; groupId?: string; templateId?: string; recipients?: Array<{ recipientId: string; role: 'to' | 'cc' }> }, opts: MailOpts = {},
): Promise<{ draft: MailDraft; notice: Notice }> {
  const now = opts.now ?? (() => new Date());
  const ns = new NoticeStore(store);
  return store.withLock(editLockKey(p.noticeId), async () => {
    if (opts.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const notice = await ns.loadNotice(p.noticeId);
    if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');

    const cfg = await listRecipients(store, { now });
    const tpls = await listTemplates(store, { now });

    // 그룹: recipients(합성) → payload groupId → notice.mail.groupId(존재 시) → 기본 그룹
    let group: Group | undefined;
    let synthetic = false;
    if (p.recipients !== undefined) {
      if (p.recipients.length === 0) throw err('NO_RECIPIENTS', '메일을 받을 수신자가 없습니다.');
      const memberIds: string[] = [];
      const roleOverrides: Record<string, 'to' | 'cc'> = {};
      for (const m of p.recipients) {
        if (Object.hasOwn(roleOverrides, m.recipientId)) continue;
        memberIds.push(m.recipientId);
        roleOverrides[m.recipientId] = m.role;
      }
      group = { id: 'auto-custom', name: '자동 작성 수신자', memberIds, roleOverrides, isDefault: false, updatedAt: now().toISOString() };
      synthetic = true;
    } else {
      group = p.groupId !== undefined ? cfg.groups.find((g) => g.id === p.groupId) : undefined;
      if (p.groupId !== undefined && !group) throw err('GROUP_NOT_FOUND', '그룹을 찾을 수 없습니다.');
      group ??= cfg.groups.find((g) => g.id === notice.mail.groupId) ?? cfg.groups.find((g) => g.isDefault);
    }
    if (!group) throw err('NO_GROUP', '수신 그룹이 없습니다. 그룹을 선택하거나 기본 그룹을 지정하세요.');

    // 템플릿: payload → notice.mail.templateId(존재 시) → 기본(없으면 첫 항목)
    let tpl = p.templateId !== undefined ? tpls.templates.find((t) => t.id === p.templateId) : undefined;
    if (p.templateId !== undefined && !tpl) throw err('TEMPLATE_NOT_FOUND', '템플릿을 찾을 수 없습니다.');
    tpl ??= tpls.templates.find((t) => t.id === notice.mail.templateId) ?? tpls.templates.find((t) => t.isDefault) ?? tpls.templates[0]!;

    const resolved = resolveRecipients(group, cfg.recipients);
    if (resolved.to.length === 0 && resolved.cc.length === 0) throw err('NO_RECIPIENTS', '메일을 받을 수신자가 없습니다.');
    const warnings: string[] = [];
    const excluded = resolved.skipped.filter((s) => s.reason === 'missing' || s.reason === 'disabled').length;
    if (excluded > 0) warnings.push(`삭제되거나 사용 안 함인 수신자 ${excluded}명 제외`);
    if (resolved.to.length === 0) warnings.push('TO 수신자가 없습니다');

    const rendered = renderMail(tpl, notice);
    const attachments: DraftAttachment[] = [];
    const skippedAttachments: MailDraft['skippedAttachments'] = [];
    for (const a of notice.attachments) {
      if (a.status === 'saved' && a.savedName) {
        attachments.push({ attachmentId: a.id, name: a.originalName, path: `${notice.folder}/attachments/${a.savedName}`, size: a.savedSize ?? a.expectedSize ?? 0 });
      } else {
        skippedAttachments.push({ attachmentId: a.id, name: a.originalName, status: a.status });
      }
    }
    if (skippedAttachments.length > 0) warnings.push(`첨부 ${skippedAttachments.length}개가 저장되지 않았습니다`);

    const nowIso = now().toISOString();
    const draft: MailDraft = {
      schemaVersion: 1, noticeId: notice.id, preparedAt: nowIso, templateId: tpl.id,
      ...(synthetic ? { recipientSource: 'custom' as const } : { groupId: group.id, recipientSource: 'group' as const }),
      to: resolved.to, cc: resolved.cc, subject: rendered.subject, html: rendered.html, text: rendered.text,
      attachments, skippedAttachments, unresolved: rendered.unresolved, unknownVars: rendered.unknownVars, warnings,
    };
    await writeJson(store, draftPath(notice.folder), draft);

    notice.mail = { ...notice.mail, status: notice.mail.status === 'delivered' ? 'delivered' : 'drafting', ...(synthetic ? {} : { groupId: group.id }), templateId: tpl.id };
    notice.updatedAt = nowIso;
    await ns.saveNotice(notice);
    return { draft, notice };
  });
}

/** 전달 완료 표시/해제. none이면 초안 파일 유무로 drafting/none을 정한다. */
export async function setMailStatus(
  store: IFileStore, p: { noticeId: string; status: 'delivered' | 'none' }, opts: MailOpts = {},
): Promise<{ notice: Notice }> {
  if (p.status !== 'delivered' && p.status !== 'none') throw err('INVALID_VALUE', '상태 값이 올바르지 않습니다.');
  const now = opts.now ?? (() => new Date());
  const ns = new NoticeStore(store);
  return store.withLock(editLockKey(p.noticeId), async () => {
    if (opts.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const notice = await ns.loadNotice(p.noticeId);
    if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
    const nowIso = now().toISOString();
    if (p.status === 'delivered') {
      notice.mail = { ...notice.mail, status: 'delivered', deliveredAt: nowIso };
    } else {
      const { deliveredAt: _removed, ...rest } = notice.mail;
      notice.mail = { ...rest, status: (await readDraft(store, notice.folder)) ? 'drafting' : 'none' };
    }
    notice.updatedAt = nowIso;
    await ns.saveNotice(notice);
    return { notice };
  });
}

/** compose/fill 입력과 compose/attach-begin의 FileMeta[]로 변환한다. fileId=attachmentId, name=저장 파일명. */
export function draftToComposeFill(draft: MailDraft): { fill: { to: string[]; cc: string[]; subject: string; html: string }; files: FileMeta[] } {
  return {
    fill: { to: draft.to, cc: draft.cc, subject: draft.subject, html: draft.html },
    files: draft.attachments.map((a) => ({ fileId: a.attachmentId, name: a.path.slice(a.path.lastIndexOf('/') + 1), size: a.size })),
  };
}
