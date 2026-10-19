import { describe, expect, it } from 'vitest';
import { attributeCompose, deriveMailStatus, legacyRecord, sentIndexEntryOf, summaryOf } from '../../src/core/mail/sent-derive';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { ComposeRecord, SendRecord } from '../../src/core/types/compose';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { MailDraft } from '../../src/core/types/mail';

const rec = (id: string, sentAt: string, extra: Partial<SendRecord> = {}): SendRecord => ({
  id, noticeId: 'N1', sentAt, recordedAt: sentAt, source: 'manual', summary: { subject: '', toCount: 0, ccCount: 0, attachmentCount: 0 }, ...extra,
});
const comp = (id: string, composedAt: string): ComposeRecord => ({
  id, jobId: 'j', noticeId: 'N1', composedAt, templateId: 't', snapshot: { to: ['a', 'b'], cc: ['c'], subject: '제목', html: '' },
  fields: [], attachments: [{ fileId: 'f', name: 'x', size: 1, status: 'uploaded', method: 'input', elapsedMs: 1 }],
  outcome: 'ready_for_review', adapterId: 'a', selectorSetVersion: 'v', webmailUrl: '',
});

describe('deriveMailStatus', () => {
  it('유효 기록이 있으면 delivered, 최신 sentAt, 개수', () => {
    const m = deriveMailStatus([rec('a', '2026-10-01T00:00:00Z'), rec('b', '2026-10-03T00:00:00Z'), rec('c', '2026-10-05T00:00:00Z', { voidedAt: 'x' })], false, { status: 'none' });
    expect(m).toMatchObject({ status: 'delivered', deliveredAt: '2026-10-03T00:00:00Z', sentCount: 2 });
  });
  it('유효 기록이 없고 prev가 delivered면 초안 유무로 drafting/none, 필드 제거', () => {
    const prev = { status: 'delivered' as const, deliveredAt: 'x', sentCount: 1, groupId: 'g' };
    const a = deriveMailStatus([rec('a', '2026-10-01T00:00:00Z', { voidedAt: 'v' })], true, prev);
    expect(a).toEqual({ status: 'drafting', groupId: 'g' });
    expect(deriveMailStatus([], false, prev).status).toBe('none');
  });
  it('prev가 delivered가 아니면 status 유지', () => {
    expect(deriveMailStatus([], true, { status: 'ready_for_review' }).status).toBe('ready_for_review');
  });
});

describe('legacyRecord', () => {
  it('delivered + deliveredAt이면 가상 기록, 아니면 null', () => {
    const n = sampleNotice();
    n.id = 'N1';
    expect(legacyRecord(n)).toBeNull();
    n.mail = { status: 'delivered', deliveredAt: '2026-10-01T00:00:00Z' };
    expect(legacyRecord(n)).toMatchObject({ id: 'legacy-N1', noticeId: 'N1', source: 'manual', sentAt: '2026-10-01T00:00:00Z' });
    n.mail = { status: 'delivered' };
    expect(legacyRecord(n)).toBeNull();
  });
});

describe('attributeCompose', () => {
  const cs = [comp('c1', '2026-10-01T00:00:00Z'), comp('c2', '2026-10-05T00:00:00Z')];
  it('기록이 없으면 최신 작성 기록', () => {
    expect(attributeCompose([], cs)?.id).toBe('c2');
  });
  it('마지막 유효 발송보다 뒤의 것만, 없으면 null', () => {
    expect(attributeCompose([rec('a', '2026-10-03T00:00:00Z')], cs)?.id).toBe('c2');
    expect(attributeCompose([rec('a', '2026-10-06T00:00:00Z')], cs)).toBeNull();
  });
  it('취소된 기록은 기준에서 제외한다', () => {
    expect(attributeCompose([rec('a', '2026-10-06T00:00:00Z', { voidedAt: 'v' })], cs)?.id).toBe('c2');
  });
});

describe('summaryOf / sentIndexEntryOf', () => {
  it('작성 기록 우선, 초안, 빈 값', () => {
    expect(summaryOf(comp('c', '2026-10-01T00:00:00Z'), null)).toEqual({ subject: '제목', toCount: 2, ccCount: 1, attachmentCount: 1 });
    const d = { subject: 'D', to: ['a'], cc: [], attachments: [] } as unknown as MailDraft;
    expect(summaryOf(null, d)).toEqual({ subject: 'D', toCount: 1, ccCount: 0, attachmentCount: 0 });
    expect(summaryOf(null, null).subject).toBe('');
  });
  it('index 항목을 만든다', () => {
    const e = { noticeId: 'N1', noticeNo: 'R1', round: '000', title: '공고', orderingOrg: '기관', folder: 'f' } as IndexEntry;
    const r = rec('a', '2026-10-01T00:00:00Z', { source: 'auto', signal: { kind: 'click', confirmed: true }, composeRecordId: 'c1' });
    expect(sentIndexEntryOf(r, e)).toMatchObject({ id: 'a', noticeNo: 'R1', title: '공고', confirmed: true, composeRecordId: 'c1', source: 'auto' });
    expect('voidedAt' in sentIndexEntryOf(r, e)).toBe(false);
  });
});
