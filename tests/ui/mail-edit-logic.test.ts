import { describe, expect, it } from 'vitest';
import {
  addRecipient, convertItem, overrideValue, removeRecipient, resetRecipients, startEditing, toggleAttachment,
} from '../../src/entrypoints/dashboard/mail-edit-logic';
import { createMailEdits, fieldItemToText } from '../../src/core/mail/edits';
import { builtinDefaultTemplate } from '../../src/core/templates/default-template';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { TemplateFieldItem } from '../../src/core/types/template';

const now = new Date('2026-01-01T00:00:00.000Z');
const tpl = () => builtinDefaultTemplate(now);
const base = () => ({ to: ['a@x.com'], cc: ['b@x.com'] });
const mk = () => createMailEdits('n1', tpl(), now);

describe('startEditing', () => {
  it('working이 null이면 템플릿 복사본으로 새로 만든다', () => {
    const t = tpl();
    const e = startEditing(null, 'n1', t, now);
    expect(e.template.id).toBe(t.id);
    expect(e.template.subject).toBe(t.subject);
    expect(e.template).not.toBe(t);
    expect(e.base.templateId).toBe(t.id);
    expect(e.excludedAttachmentIds).toEqual([]);
  });
  it('working이 있으면 같은 객체를 반환한다', () => {
    const w = mk();
    expect(startEditing(w, 'n1', tpl(), now)).toBe(w);
  });
});

describe('addRecipient', () => {
  it('잘못된 이메일은 invalid', () => {
    expect(addRecipient(mk(), base(), 'not-an-email', 'to')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('to/cc에 이미 있으면 대소문자 무관하게 duplicate', () => {
    expect(addRecipient(mk(), base(), 'A@X.com', 'cc')).toEqual({ ok: false, reason: 'duplicate' });
    expect(addRecipient(mk(), base(), 'B@x.COM', 'to')).toEqual({ ok: false, reason: 'duplicate' });
  });
  it('recipients가 없으면 base로 시작해 role 끝에 정규화된 주소를 붙인다', () => {
    const r = addRecipient(mk(), base(), '  New@X.COM ', 'cc');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.recipients).toEqual({ to: ['a@x.com'], cc: ['b@x.com', 'new@x.com'] });
    const r2 = addRecipient(mk(), base(), 'c@x.com', 'to');
    if (r2.ok) expect(r2.value.recipients).toEqual({ to: ['a@x.com', 'c@x.com'], cc: ['b@x.com'] });
  });
  it('원본 e는 변하지 않는다', () => {
    const e = mk();
    addRecipient(e, base(), 'new@x.com', 'to');
    expect(e.recipients).toBeUndefined();
  });
});

describe('removeRecipient', () => {
  it('recipients가 없으면 base로 시작해 to/cc 모두에서 제거', () => {
    const b = { to: ['a@x.com', 'd@x.com'], cc: ['a@x.com', 'b@x.com'] };
    const r = removeRecipient(mk(), b, 'a@x.com');
    expect(r.recipients).toEqual({ to: ['d@x.com'], cc: ['b@x.com'] });
  });
});

describe('resetRecipients', () => {
  it('recipients 키 자체가 없어진다', () => {
    const e = { ...mk(), recipients: { to: ['a@x.com'], cc: [] } };
    expect('recipients' in resetRecipients(e)).toBe(false);
  });
});

describe('toggleAttachment', () => {
  it('없으면 추가, 있으면 제거', () => {
    const e = mk();
    const added = toggleAttachment(e, 'att1');
    expect(added.excludedAttachmentIds).toEqual(['att1']);
    expect(toggleAttachment(added, 'att1').excludedAttachmentIds).toEqual([]);
  });
});

describe('convertItem', () => {
  const notice = sampleNotice();
  const secInfo = (e: ReturnType<typeof mk>) => e.template.sections.find((s) => s.id === 'sec_info')!;

  it('필드 항목이 현재 값이 채워진 text 항목으로 바뀐다', () => {
    const e = mk();
    const before = secInfo(e).items[0] as TemplateFieldItem;
    expect(before.fieldKey).toBeDefined();
    const out = convertItem(e, 'sec_info', 0, notice, now);
    const it = secInfo(out).items[0]!;
    const expected = fieldItemToText(before, notice, now);
    expect(it.kind).toBe('text');
    if (it.kind === 'text') {
      expect(it.text).toBe(expected.text);
      expect(it.label).toBe(before.label);
      expect(it.visible).toBe(before.visible);
    }
  });
  it('문구 항목 index면 그대로', () => {
    const e = mk();
    const out = convertItem(e, 'sec_info', 1, notice, now);
    expect(secInfo(out).items[1]).toEqual(secInfo(e).items[1]);
  });
  it('다른 섹션은 불변', () => {
    const e = mk();
    const out = convertItem(e, 'sec_info', 0, notice, now);
    for (const s of e.template.sections) {
      if (s.id === 'sec_info') continue;
      expect(out.template.sections.find((x) => x.id === s.id)).toEqual(s);
    }
  });
  it('입력 e.template은 불변', () => {
    const e = mk();
    const snap = structuredClone(e.template);
    convertItem(e, 'sec_info', 0, notice, now);
    expect(e.template).toEqual(snap);
  });
});

describe('overrideValue', () => {
  const n = sampleNotice();
  it('해당 필드 항목을 입력값 문구 항목으로 바꾸고 되돌리기용 fromFieldKey를 남긴다', () => {
    const e = overrideValue(mk(), 'projectPeriod', '사업기간', '계약일로부터 3개월', n, now);
    const items = e.template.sections.flatMap((s) => s.items);
    expect(items.some((it) => it.kind !== 'text' && it.fieldKey === 'projectPeriod')).toBe(false);
    const t = items.find((it) => it.kind === 'text' && it.fromFieldKey === 'projectPeriod');
    expect(t && t.kind === 'text' && t.text).toBe('계약일로부터 3개월');
  });
  it('이미 바꾼 문구 항목은 글만 새 값으로 바꾼다', () => {
    const once = overrideValue(mk(), 'projectPeriod', '사업기간', 'A', n, now);
    const twice = overrideValue(once, 'projectPeriod', '사업기간', 'B', n, now);
    const ts = twice.template.sections.flatMap((s) => s.items).filter((it) => it.kind === 'text' && it.fromFieldKey === 'projectPeriod');
    expect(ts.map((it) => it.kind === 'text' && it.text)).toEqual(ts.map(() => 'B'));
    expect(ts.length).toBeGreaterThan(0);
  });
  it('제목·인사말의 {변수}를 입력값으로 바꾼다', () => {
    const e0 = mk();
    const e1 = { ...e0, template: { ...e0.template, subject: '[{사업기간}] 안내', greeting: '기간: {사업기간}' } };
    const e = overrideValue(e1, 'projectPeriod', '사업기간', '6개월', n, now);
    expect(e.template.subject).toBe('[6개월] 안내');
    expect(e.template.greeting).toBe('기간: 6개월');
  });
});
