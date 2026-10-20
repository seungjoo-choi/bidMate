import { describe, expect, it } from 'vitest';
import { buildPlan, deadlineItemsOf, deadlineNotificationOf, duePlan, fireTimeOf, nextKstHour, pruneSent } from '../../src/core/deadline/plan';
import type { DeadlineNotice } from '../../src/core/types/deadline';
import type { IndexEntry } from '../../src/core/types/index-file';

const ms = (s: string): number => Date.parse(s);
const mk = (o: Partial<IndexEntry> & { noticeId: string }): IndexEntry => ({
  noticeNo: o.noticeId.split('-')[0] ?? '', round: '000', title: '공고', orderingOrg: '기관', folder: 'f',
  collectedAt: '2026-10-01T00:00:00Z', collectStatus: 'complete' as IndexEntry['collectStatus'],
  attachments: { total: 0, saved: 0, failed: 0 }, extractionStatus: 'not_run', mailStatus: 'delivered', isCorrection: false, ...o,
});
const note = (o: Partial<DeadlineNotice>): DeadlineNotice => ({
  noticeId: 'R1-000', title: '공고', kind: 'bidClose', at: '2026-10-22T14:00:00+09:00', offset: 1,
  fireAt: ms('2026-10-21T09:00:00+09:00'), key: 'deadline:R1-000:bidClose:1', ...o,
});

describe('fireTimeOf', () => {
  it('KST 09:00 기준 D-3, D-1, 당일', () => {
    const at = '2026-10-22T14:00:00+09:00';
    expect(fireTimeOf(at, 3)).toBe(ms('2026-10-19T00:00:00Z'));
    expect(fireTimeOf(at, 1)).toBe(ms('2026-10-21T00:00:00Z'));
    expect(fireTimeOf(at, 0)).toBe(ms('2026-10-22T00:00:00Z'));
  });
  it('KST 자정 직후 마감은 KST 날짜 기준', () => {
    expect(fireTimeOf('2026-10-23T00:30:00+09:00', 0)).toBe(ms('2026-10-23T00:00:00Z'));
  });
});

describe('deadlineItemsOf', () => {
  it('대상 공고만 고르고 일정 종류별로 만든다', () => {
    const items = deadlineItemsOf([
      mk({ noticeId: 'A-000', bidCloseAt: '2026-10-22T14:00:00+09:00' }),
      mk({ noticeId: 'B-000', bidCloseAt: '2026-10-23T14:00:00+09:00', schedule: { registrationDeadline: '2026-10-21T10:00:00+09:00' } }),
      mk({ noticeId: 'C-000', bidCloseAt: '2026-10-22T14:00:00+09:00', mailStatus: 'none' }),
      mk({ noticeId: 'D', noticeNo: 'D', kind: 'prespec', bidCloseAt: '2026-10-22T14:00:00+09:00' }),
      mk({ noticeId: 'E-000', bidCloseAt: '2026-10-22T14:00:00+09:00', supersededBy: 'E-001' }),
      mk({ noticeId: 'F-000', round: '000', bidCloseAt: '2026-10-22T14:00:00+09:00' }),
      mk({ noticeId: 'F-001', noticeNo: 'F', round: '001', bidCloseAt: '2026-10-22T15:00:00+09:00' }),
      mk({ noticeId: 'G-000', bidCloseAt: '해석불가' }),
      mk({ noticeId: 'H-000', bidCloseAt: '2026-10-22T14:00:00+09:00', mailStatus: 'none', following: 'rank' }),
    ].map((e) => (e.noticeId === 'F-000' ? { ...e, noticeNo: 'F' } : e)));
    expect(items.map((i) => `${i.noticeId}:${i.kind}`).sort()).toEqual([
      'A-000:bidClose', 'B-000:bidClose', 'B-000:registration', 'F-001:bidClose', 'H-000:bidClose',
    ]);
  });
});

describe('buildPlan', () => {
  const e = [mk({ noticeId: 'A-000', bidCloseAt: '2026-10-22T14:00:00+09:00' })];
  it('어제 것은 제외하고 D-1, 당일은 포함', () => {
    const p = buildPlan(e, ms('2026-10-20T12:00:00+09:00'));
    expect(p.items.map((i) => i.offset)).toEqual([1, 0]);
  });
  it('같은 KST 날짜의 지난 알림은 포함', () => {
    const p = buildPlan(e, ms('2026-10-19T15:00:00+09:00'));
    expect(p.items.map((i) => i.offset)).toEqual([3, 1, 0]);
  });
  it('마감 지난 공고는 제외, fireAt 오름차순', () => {
    expect(buildPlan(e, ms('2026-10-22T14:00:01+09:00')).items).toEqual([]);
    const two = [...e, mk({ noticeId: 'B-000', bidCloseAt: '2026-10-21T14:00:00+09:00' })];
    const f = buildPlan(two, ms('2026-10-19T08:00:00+09:00')).items.map((i) => i.fireAt);
    expect(f).toEqual([...f].sort((a, b) => a - b));
  });
});

describe('duePlan', () => {
  const now = ms('2026-10-21T10:00:00+09:00');
  it('오늘 지난 알림만 due, sent 제외', () => {
    const plan = { builtAt: '', items: [note({}), note({ key: 'k2', fireAt: ms('2026-10-20T09:00:00+09:00') })] };
    expect(duePlan(plan, {}, now).due.map((n) => n.key)).toEqual(['deadline:R1-000:bidClose:1']);
    expect(duePlan(plan, { 'deadline:R1-000:bidClose:1': 'x' }, now).due).toEqual([]);
  });
  it('마감이 지났으면 제외', () => {
    const plan = { builtAt: '', items: [note({ at: '2026-10-21T09:30:00+09:00' })] };
    expect(duePlan(plan, {}, now).due).toEqual([]);
  });
  it('nextAlarmAt은 미래 fireAt과 다음 09시 중 작은 값', () => {
    const plan = { builtAt: '', items: [note({ key: 'k3', offset: 0, fireAt: ms('2026-10-22T09:00:00+09:00') })] };
    expect(duePlan(plan, {}, now).nextAlarmAt).toBe(ms('2026-10-22T09:00:00+09:00'));
    const far = { builtAt: '', items: [note({ fireAt: ms('2026-10-25T09:00:00+09:00') })] };
    expect(duePlan(far, {}, now).nextAlarmAt).toBe(ms('2026-10-22T09:00:00+09:00'));
    expect(duePlan({ builtAt: '', items: [] }, {}, now).nextAlarmAt).toBe(ms('2026-10-22T09:00:00+09:00'));
  });
});

describe('nextKstHour', () => {
  it('다음 09시, 주말 포함', () => {
    expect(nextKstHour(ms('2026-10-20T08:59:00+09:00'), 9)).toBe(ms('2026-10-20T09:00:00+09:00'));
    expect(nextKstHour(ms('2026-10-20T09:00:00+09:00'), 9)).toBe(ms('2026-10-21T09:00:00+09:00'));
    expect(nextKstHour(ms('2026-10-24T12:00:00+09:00'), 9)).toBe(ms('2026-10-25T09:00:00+09:00'));
  });
});

describe('pruneSent', () => {
  it('plan에 없고 7일 넘은 키만 제거', () => {
    const now = ms('2026-10-30T00:00:00Z');
    const plan = { builtAt: '', items: [note({ key: 'keep' })] };
    const out = pruneSent({
      old: '2026-10-22T00:00:00Z', recent: '2026-10-25T00:00:00Z', keep: '2026-10-01T00:00:00Z',
    }, plan, now);
    expect(Object.keys(out).sort()).toEqual(['keep', 'recent']);
  });
});

describe('deadlineNotificationOf', () => {
  it('제목 6종', () => {
    const t = (kind: 'bidClose' | 'registration', offset: 3 | 1 | 0) => deadlineNotificationOf(note({ kind, offset })).title;
    expect([t('bidClose', 3), t('bidClose', 1), t('bidClose', 0), t('registration', 3), t('registration', 1), t('registration', 0)]).toEqual([
      '입찰 마감 D-3', '입찰 마감 D-1', '오늘 입찰 마감', '참가등록 마감 D-3', '참가등록 마감 D-1', '오늘 참가등록 마감',
    ]);
  });
  it('본문, 긴 제목 자르기, id', () => {
    const r = deadlineNotificationOf(note({ title: '공고명' }));
    expect(r.message).toBe('공고명 10/22 14:00 마감');
    expect(r.id).toBe('deadline:R1-000:bidClose:1');
    expect(deadlineNotificationOf(note({ title: 'a'.repeat(70) })).message).toBe(`${'a'.repeat(60)}… 10/22 14:00 마감`);
  });
});
