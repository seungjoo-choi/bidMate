import { describe, expect, it } from 'vitest';
import { createMailEdits, dedupeEmails, editsPath, editsStaleness, fieldItemToText, normalizeMailEdits } from '../../src/core/mail/edits';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { Template, TemplateFieldItem } from '../../src/core/types/template';

const NOW = new Date('2026-10-19T00:00:00Z');
const tpl = (): Template => ({
  id: 'tpl_1', name: '기본', isDefault: true, subject: '[{공고명}]', greeting: '안녕', closing: '감사', layout: 'table',
  sections: [{ id: 's1', title: '개요', items: [{ fieldKey: 'title', label: '공고명', visible: true }] }],
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('editsPath', () => {
  it('폴더 아래 mail-edits.json', () => expect(editsPath('notices/a')).toBe('notices/a/mail-edits.json'));
});

describe('createMailEdits', () => {
  it('깊은 복사하고 base를 기록한다', () => {
    const t = tpl();
    const e = createMailEdits('n1', t, NOW);
    expect(e.base).toEqual({ templateId: 'tpl_1', templateName: '기본', updatedAt: t.updatedAt });
    expect(e.template).toEqual(t);
    expect(e.template).not.toBe(t);
    expect(e.template.sections[0]).not.toBe(t.sections[0]);
    e.template.sections[0]!.title = '변경';
    expect(t.sections[0]!.title).toBe('개요');
    expect(e.excludedAttachmentIds).toEqual([]);
    expect(e.updatedAt).toBe(NOW.toISOString());
  });
});

describe('normalizeMailEdits', () => {
  const good = () => JSON.parse(JSON.stringify({ ...createMailEdits('n1', tpl(), NOW), recipients: { to: ['a@x.com'], cc: [] }, excludedAttachmentIds: ['n1:a0'] }));
  it('정상 값은 통과', () => {
    const e = normalizeMailEdits(good(), NOW);
    expect(e?.noticeId).toBe('n1');
    expect(e?.template.id).toBe('tpl_1');
    expect(e?.recipients).toEqual({ to: ['a@x.com'], cc: [] });
    expect(e?.excludedAttachmentIds).toEqual(['n1:a0']);
  });
  it('손상/타입 불일치는 null', () => {
    expect(normalizeMailEdits(null, NOW)).toBeNull();
    expect(normalizeMailEdits('x', NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), schemaVersion: 2 }, NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), noticeId: 1 }, NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), base: null }, NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), template: 'x' }, NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), recipients: { to: [1], cc: [] } }, NOW)).toBeNull();
    expect(normalizeMailEdits({ ...good(), excludedAttachmentIds: 'a' }, NOW)).toBeNull();
  });
});

describe('editsStaleness', () => {
  const e = createMailEdits('n1', tpl(), NOW);
  it('missing / changed / null', () => {
    expect(editsStaleness(e, undefined)).toBe('missing');
    expect(editsStaleness(e, { ...tpl(), updatedAt: '2026-10-02T00:00:00.000Z' })).toBe('changed');
    expect(editsStaleness(e, tpl())).toBeNull();
  });
});

describe('fieldItemToText', () => {
  it('해석 값을 text로 복사하고 label/visible/style을 유지', () => {
    const item: TemplateFieldItem = { fieldKey: 'title', label: '공고명', visible: false, style: { bold: true } };
    const t = fieldItemToText(item, sampleNotice(), NOW);
    expect(t.kind).toBe('text');
    expect(t.id).toMatch(/^txt_/);
    expect(t.text).toBe('2026년 정보시스템 고도화 사업');
    expect(t.label).toBe('공고명');
    expect(t.visible).toBe(false);
    expect(t.style).toEqual({ bold: true });
  });
  it('style이 없으면 속성도 없다', () => {
    const t = fieldItemToText({ fieldKey: 'today', label: '작성일', visible: true }, sampleNotice(), NOW);
    expect('style' in t).toBe(false);
    expect(t.text).toBe('20261019');
  });
});

describe('dedupeEmails', () => {
  it('TO 우선, 대소문자/공백 정규화, 빈 값 제거, 순서 유지', () => {
    expect(dedupeEmails({ to: [' A@x.com', 'b@x.com', '', 'a@X.com'], cc: ['B@x.com', 'c@x.com', 'C@x.com ', '  '] }))
      .toEqual({ to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'] });
  });
});
