import { normalizeEmail } from '../recipients/email';
import { newId } from '../model/ids';
import { normalizeTemplate } from '../templates/normalize';
import { resolveValue } from '../templates/values';
import type { MailEdits } from '../types/mail';
import type { Notice } from '../types/notice';
import type { Template, TemplateFieldItem, TemplateFieldKey, TemplateTextItem } from '../types/template';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');

export const editsPath = (folder: string): string => `${folder}/mail-edits.json`;

/** 공고 전용 편집본을 만든다. 템플릿은 깊은 복사(id 유지). */
export function createMailEdits(noticeId: string, template: Template, now: Date): MailEdits {
  const iso = now.toISOString();
  return {
    schemaVersion: 1,
    noticeId,
    updatedAt: iso,
    base: { templateId: template.id, templateName: template.name, updatedAt: template.updatedAt },
    template: structuredClone(template),
    excludedAttachmentIds: [],
  };
}

/** 저장된 원본을 MailEdits로 검증한다. 형식이 맞지 않으면 null. */
export function normalizeMailEdits(raw: unknown, now: Date): MailEdits | null {
  if (!isObj(raw) || raw.schemaVersion !== 1) return null;
  if (typeof raw.noticeId !== 'string' || !raw.noticeId) return null;
  if (!isObj(raw.base) || typeof raw.base.templateId !== 'string') return null;
  if (!isObj(raw.template)) return null;
  if (!isStrArr(raw.excludedAttachmentIds)) return null;
  let recipients: MailEdits['recipients'];
  if (raw.recipients !== undefined) {
    if (!isObj(raw.recipients) || !isStrArr(raw.recipients.to) || !isStrArr(raw.recipients.cc)) return null;
    recipients = { to: [...raw.recipients.to], cc: [...raw.recipients.cc] };
  }
  const template = normalizeTemplate(raw.template, now).template;
  return {
    schemaVersion: 1,
    noticeId: raw.noticeId,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now.toISOString(),
    base: {
      templateId: raw.base.templateId,
      templateName: typeof raw.base.templateName === 'string' ? raw.base.templateName : '',
      updatedAt: typeof raw.base.updatedAt === 'string' ? raw.base.updatedAt : '',
    },
    template,
    ...(recipients ? { recipients } : {}),
    excludedAttachmentIds: [...raw.excludedAttachmentIds],
  };
}

/** 원본 템플릿 대비 상태. missing=삭제됨, changed=updatedAt 다름, null=그대로. */
export function editsStaleness(e: MailEdits, current?: Template): 'missing' | 'changed' | null {
  if (!current) return 'missing';
  return current.updatedAt !== e.base.updatedAt ? 'changed' : null;
}

/** 필드 항목을 현재 해석 값의 text 항목으로 전환한다(label/visible/style 유지, 원래 변수는 fromFieldKey에 기억). */
export function fieldItemToText(item: TemplateFieldItem, notice: Notice, now: Date): TemplateTextItem {
  return {
    kind: 'text',
    id: newId('txt'),
    label: item.label,
    text: resolveValue(notice, item.fieldKey, now).text,
    visible: item.visible,
    ...(item.style ? { style: { ...item.style } } : {}),
    fromFieldKey: item.fieldKey,
  };
}

/** [값 고치기]로 바뀐 text 항목을 원래 필드 항목으로 되돌린다(label/visible/style 유지). */
export function textItemToField(item: TemplateTextItem & { fromFieldKey: TemplateFieldKey }): TemplateFieldItem {
  return {
    fieldKey: item.fromFieldKey,
    label: item.label,
    visible: item.visible,
    ...(item.style ? { style: { ...item.style } } : {}),
  };
}

/** 이메일을 정규화하고 빈 값/중복을 제거한다. TO 우선, 순서 유지. */
export function dedupeEmails(r: { to: string[]; cc: string[] }): { to: string[]; cc: string[] } {
  const seen = new Set<string>();
  const pick = (list: string[]): string[] => {
    const out: string[] = [];
    for (const v of list) {
      const e = normalizeEmail(v);
      if (!e || seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
    return out;
  };
  const to = pick(r.to);
  return { to, cc: pick(r.cc) };
}
