import { resolveRecipients } from '../../core/recipients/resolve';
import { renderMail } from '../../core/templates/render';
import type { Group } from '../../core/types/recipient';
import { dedupeEmails, editsPath, editsStaleness, normalizeMailEdits } from '../../core/mail/edits';
import type { DraftAttachment, MailDraft, MailEdits } from '../../core/types/mail';
import { kindOf } from '../../core/model/ids';
import type { Notice, NoticeKind } from '../../core/types/notice';
import type { Template } from '../../core/types/template';
import type { FileMeta } from '../../messaging/protocol';
import { listRecipients } from '../config/recipients-api';
import { listTemplates } from '../config/templates-api';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from '../notices/notice-store';

const KIND_LABEL: Record<NoticeKind, string> = { bid: '입찰공고', prespec: '사전규격', orderplan: '발주계획' };
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface MailOpts { now?: () => Date; isBusy?: (noticeId: string) => boolean }

export const draftPath = (folder: string): string => `${folder}/mail-draft.json`;

/** 초안을 읽는다. 없거나 손상되면 null. 권한 오류만 던진다. */
export async function readDraft(store: IFileStore, folder: string): Promise<MailDraft | null> {
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

/** 편집 파일을 읽는다. 없으면 {edits:null}, 손상이면 {edits:null, corrupt:true}. 권한 오류만 던진다. */
async function readEdits(store: IFileStore, folder: string, now: Date): Promise<{ edits: MailEdits | null; corrupt: boolean }> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(store, editsPath(folder));
  } catch (e) {
    const x = e as { code?: string; name?: string } | null;
    if (x?.code === 'NEEDS_FS_PERMISSION') throw e;
    if (x?.name === 'NotFoundError' || x?.code === 'NOT_FOUND') return { edits: null, corrupt: false };
    return { edits: null, corrupt: true };
  }
  const edits = normalizeMailEdits(raw, now);
  return { edits, corrupt: edits === null };
}

export async function getEdits(store: IFileStore, noticeId: string): Promise<MailEdits | null> {
  const notice = await new NoticeStore(store).loadNotice(noticeId);
  if (!notice) return null;
  return (await readEdits(store, notice.folder, new Date())).edits;
}

/**
 * 메일 초안을 만들어 `<folder>/mail-draft.json`에 쓰고 notice.mail을 갱신한다.
 * 공고 락 안에서 notice를 다시 읽고, config 락은 잡지 않은 채 저장한다(락 안이라 saveNotice를 직접 쓴다).
 */
export async function prepareMail(
  store: IFileStore, p: { noticeId: string; groupId?: string; templateId?: string; recipients?: Array<{ recipientId: string; role: 'to' | 'cc' }>; edits?: MailEdits | null }, opts: MailOpts = {},
): Promise<{ draft: MailDraft; notice: Notice }> {
  const now = opts.now ?? (() => new Date());
  const ns = new NoticeStore(store);
  return store.withLock(editLockKey(p.noticeId), async () => {
    if (opts.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const notice = await ns.loadNotice(p.noticeId);
    if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');

    // 편집: null이면 없는 것으로 렌더(삭제는 마지막), 객체면 검증 후 메모리에서 사용(저장은 마지막), 없으면 기존 파일 사용
    let edits: MailEdits | null = null;
    let corrupt = false;
    if (p.edits === undefined) {
      ({ edits, corrupt } = await readEdits(store, notice.folder, now()));
    } else if (p.edits !== null) {
      edits = normalizeMailEdits(p.edits, now());
      if (!edits || edits.noticeId !== notice.id) throw err('INVALID_VALUE', '편집 데이터가 올바르지 않습니다.');
    }
    const warnings: string[] = [];
    if (corrupt) warnings.push('편집 파일이 손상되어 무시했습니다');

    const cfg = await listRecipients(store, { now });
    const tpls = await listTemplates(store, { now });
    const editedRecipients = edits?.recipients ? dedupeEmails(edits.recipients) : undefined;
    if (editedRecipients && editedRecipients.to.length === 0 && editedRecipients.cc.length === 0) throw err('NO_RECIPIENTS', '메일을 받을 수신자가 없습니다.');

    // 그룹: recipients(합성) → payload groupId → notice.mail.groupId(존재 시) → 기본 그룹
    let group: Group | undefined;
    let synthetic = false;
    if (editedRecipients) {
      // 편집 수신자가 있으면 그룹을 쓰지 않는다
    } else if (p.recipients !== undefined) {
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
    if (!group && !editedRecipients) throw err('NO_GROUP', '수신 그룹이 없습니다. 그룹을 선택하거나 기본 그룹을 지정하세요.');

    // 템플릿: 편집 복사본 → payload → notice.mail.templateId(존재 시) → 공고 종류 기본 → 그 종류 첫 항목
    const noticeKind = kindOf(notice.ref);
    const sameKind = tpls.templates.filter((t) => kindOf(t) === noticeKind);
    let tpl: Template | undefined;
    if (edits) {
      tpl = edits.template;
      const current = tpls.templates.find((t) => t.id === edits.base.templateId);
      if (p.templateId !== undefined && p.templateId !== edits.base.templateId) {
        warnings.push(`이 공고 전용 양식(템플릿 '${edits.base.templateName}' 기준)을 사용했습니다. 요청한 템플릿은 적용하지 않았습니다`);
      }
      const stale = editsStaleness(edits, current);
      if (stale === 'missing') warnings.push('원본 템플릿이 삭제되었습니다');
      else if (stale === 'changed') warnings.push('원본 템플릿이 변경되었습니다. 이 공고 양식은 저장 당시 복사본입니다');
    } else {
      tpl = p.templateId !== undefined ? tpls.templates.find((t) => t.id === p.templateId) : undefined;
      if (p.templateId !== undefined && !tpl) throw err('TEMPLATE_NOT_FOUND', '템플릿을 찾을 수 없습니다.');
      tpl ??= tpls.templates.find((t) => t.id === notice.mail.templateId) ?? sameKind.find((t) => t.isDefault) ?? sameKind[0] ?? tpls.templates[0]!;
    }

    let to: string[];
    let cc: string[];
    if (editedRecipients) {
      ({ to, cc } = editedRecipients);
    } else {
      const resolved = resolveRecipients(group!, cfg.recipients);
      if (resolved.to.length === 0 && resolved.cc.length === 0) throw err('NO_RECIPIENTS', '메일을 받을 수신자가 없습니다.');
      const excluded = resolved.skipped.filter((s) => s.reason === 'missing' || s.reason === 'disabled').length;
      if (excluded > 0) warnings.push(`삭제되거나 사용 안 함인 수신자 ${excluded}명 제외`);
      ({ to, cc } = resolved);
    }
    if (to.length === 0) warnings.push('TO 수신자가 없습니다');
    if (kindOf(tpl) !== noticeKind) warnings.push(`템플릿 종류(${KIND_LABEL[kindOf(tpl)]})가 공고 종류(${KIND_LABEL[noticeKind]})와 다릅니다`);

    const rendered = renderMail(tpl, notice);
    const attachments: DraftAttachment[] = [];
    const skippedAttachments: MailDraft['skippedAttachments'] = [];
    const excludedAttachments: NonNullable<MailDraft['excludedAttachments']> = [];
    const excludedIds = new Set(edits?.excludedAttachmentIds ?? []);
    for (const a of notice.attachments) {
      if (a.status === 'saved' && a.savedName) {
        if (excludedIds.has(a.id)) { excludedAttachments.push({ attachmentId: a.id, name: a.originalName }); continue; }
        attachments.push({ attachmentId: a.id, name: a.originalName, path: `${notice.folder}/attachments/${a.savedName}`, size: a.savedSize ?? a.expectedSize ?? 0 });
      } else {
        skippedAttachments.push({ attachmentId: a.id, name: a.originalName, status: a.status });
      }
    }
    if (skippedAttachments.length > 0) warnings.push(`첨부 ${skippedAttachments.length}개가 저장되지 않았습니다`);

    const nowIso = now().toISOString();
    const draft: MailDraft = {
      schemaVersion: 1, noticeId: notice.id, preparedAt: nowIso, templateId: tpl.id,
      ...(editedRecipients ? { recipientSource: 'edited' as const } : synthetic ? { recipientSource: 'custom' as const } : { groupId: group!.id, recipientSource: 'group' as const }),
      to, cc, subject: rendered.subject, html: rendered.html, text: rendered.text,
      attachments, skippedAttachments, unresolved: rendered.unresolved, unknownVars: rendered.unknownVars, warnings,
      ...(excludedAttachments.length > 0 ? { excludedAttachments } : {}),
      ...(edits ? { edited: { at: edits.updatedAt } } : {}),
    };
    // 모든 검사가 끝난 뒤에만 편집 파일을 바꾼다(실패 시 이전 상태 유지)
    if (p.edits === null) {
      try { await store.remove(editsPath(notice.folder)); } catch (e) {
        const x = e as { name?: string; code?: string } | null;
        if (x?.name !== 'NotFoundError' && x?.code !== 'NOT_FOUND') throw e;
      }
    } else if (p.edits !== undefined && edits) {
      await writeJson(store, editsPath(notice.folder), edits);
    }
    await writeJson(store, draftPath(notice.folder), draft);

    notice.mail = { ...notice.mail, status: notice.mail.status === 'delivered' ? 'delivered' : 'drafting', ...(synthetic || editedRecipients ? {} : { groupId: group!.id }), templateId: tpl.id };
    notice.updatedAt = nowIso;
    await ns.saveNotice(notice);
    return { draft, notice };
  });
}

/** compose/fill 입력과 compose/attach-begin의 FileMeta[]로 변환한다. fileId=attachmentId, name=저장 파일명. */
export function draftToComposeFill(draft: MailDraft): { fill: { to: string[]; cc: string[]; subject: string; html: string }; files: FileMeta[] } {
  return {
    fill: { to: draft.to, cc: draft.cc, subject: draft.subject, html: draft.html },
    files: draft.attachments.map((a) => ({ fileId: a.attachmentId, name: a.path.slice(a.path.lastIndexOf('/') + 1), size: a.size })),
  };
}
