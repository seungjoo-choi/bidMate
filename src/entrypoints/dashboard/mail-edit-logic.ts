import { createMailEdits, fieldItemToText, textItemToField } from '../../core/mail/edits';
import { isValidEmail, normalizeEmail } from '../../core/recipients/email';
import type { MailEdits } from '../../core/types/mail';
import type { Notice } from '../../core/types/notice';
import type { Template, TemplateFieldKey } from '../../core/types/template';

export type Role = 'to' | 'cc';
export type Recipients = { to: string[]; cc: string[] };

/** 편집 중인 복사본이 없으면 선택한 템플릿으로 새로 만든다. */
export function startEditing(working: MailEdits | null, noticeId: string, template: Template, now: Date): MailEdits {
  return working ?? createMailEdits(noticeId, template, now);
}

/** 템플릿 복사본의 일부를 바꾼다. */
export function patchTemplate(e: MailEdits, patch: Partial<Template>): MailEdits {
  return { ...e, template: { ...e.template, ...patch } };
}

/** 덮어쓴 수신자가 없으면 그룹 해석 결과(base)로 시작한다. */
const current = (e: MailEdits, base: Recipients): Recipients => e.recipients ?? { to: [...base.to], cc: [...base.cc] };

export type AddResult = { ok: true; value: MailEdits } | { ok: false; reason: 'invalid' | 'duplicate' };

export function addRecipient(e: MailEdits, base: Recipients, email: string, role: Role): AddResult {
  const v = normalizeEmail(email);
  if (!isValidEmail(v)) return { ok: false, reason: 'invalid' };
  const r = current(e, base);
  if (r.to.includes(v) || r.cc.includes(v)) return { ok: false, reason: 'duplicate' };
  return { ok: true, value: { ...e, recipients: { ...r, [role]: [...r[role], v] } } };
}

export function removeRecipient(e: MailEdits, base: Recipients, email: string): MailEdits {
  const r = current(e, base);
  return { ...e, recipients: { to: r.to.filter((x) => x !== email), cc: r.cc.filter((x) => x !== email) } };
}

/** 수신자 덮어쓰기를 없애 그룹 해석으로 되돌린다. */
export function resetRecipients(e: MailEdits): MailEdits {
  const { recipients: _old, ...rest } = e;
  return rest;
}

export function toggleAttachment(e: MailEdits, attachmentId: string): MailEdits {
  const ids = e.excludedAttachmentIds;
  return { ...e, excludedAttachmentIds: ids.includes(attachmentId) ? ids.filter((x) => x !== attachmentId) : [...ids, attachmentId] };
}

/** 섹션의 필드 항목을 현재 값이 채워진 문구 항목으로 바꾼다. 문구 항목이면 그대로 둔다. */
export function convertItem(e: MailEdits, sectionId: string, itemIndex: number, notice: Notice, now: Date): MailEdits {
  const sections = e.template.sections.map((s) => {
    if (s.id !== sectionId) return s;
    return { ...s, items: s.items.map((it, i) => (i === itemIndex && it.kind !== 'text' ? fieldItemToText(it, notice, now) : it)) };
  });
  return patchTemplate(e, { sections });
}

/** [값 고치기]로 바뀐 문구 항목을 원래 공고 값 항목으로 되돌린다. 해당 없으면 그대로 둔다. */
export function revertItem(e: MailEdits, sectionId: string, itemIndex: number): MailEdits {
  const sections = e.template.sections.map((s) => {
    if (s.id !== sectionId) return s;
    return { ...s, items: s.items.map((it, i) => (i === itemIndex && it.kind === 'text' && it.fromFieldKey ? textItemToField({ ...it, fromFieldKey: it.fromFieldKey }) : it)) };
  });
  return patchTemplate(e, { sections });
}

/** 이 메일에서만 fieldKey 값을 text로 고정한다. 필드 항목은 문구 항목([값 고치기]와 같은 모양)으로, 제목·인사말·맺음말·구역 제목·문구 속 {varName}은 text로 바꾼다. */
export function overrideValue(e: MailEdits, fieldKey: TemplateFieldKey, varName: string, text: string, notice: Notice, now: Date): MailEdits {
  const token = `{${varName}}`;
  const rep = (s: string) => s.split(token).join(text);
  const t = e.template;
  const sections = t.sections.map((s) => ({
    ...s,
    title: rep(s.title),
    ...(s.inlineValue !== undefined ? { inlineValue: rep(s.inlineValue) } : {}),
    items: s.items.map((it) => {
      if (it.kind === 'text') return it.fromFieldKey === fieldKey ? { ...it, text } : { ...it, text: rep(it.text) };
      return it.fieldKey === fieldKey ? { ...fieldItemToText(it, notice, now), text } : it;
    }),
  }));
  return patchTemplate(e, { subject: rep(t.subject), greeting: rep(t.greeting), closing: rep(t.closing), sections });
}
