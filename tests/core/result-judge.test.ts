import { describe, expect, it } from 'vitest';
import type { AwardResult, OpeningResult, OpeningRow } from '../../src/adapters/g2b/award-api';
import { applyOurAmount, backoffMs, fillScoreRanks, judge, shouldFetchAward } from '../../src/core/results/judge';
import { backfillTargets, newEntry, planTargets, resetForBiz } from '../../src/core/results/plan';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { FollowFile, ResultEntry, ResultFile } from '../../src/core/types/result';

const OURS = '1234567890';
const NOW = new Date('2026-10-20T12:00:00+09:00');
const MIN = 60_000;
const H = 3600_000;
const row = (bizNo: string, rank: number | null, extra: Partial<OpeningRow> = {}): OpeningRow => ({ bizNo, rank, totalScore: rank === null ? null : 90, rbidNo: null, bidAmount: null, won: null, noBid: null, ...extra });
const opening = (rows: OpeningRow[]): OpeningResult => ({ ok: true, rows, fetchedAt: NOW.toISOString() });
const award = (bizNo: string | null, name = '타사'): AwardResult => ({ ok: true, rows: bizNo ? [{ bizNo, name, amount: 5000, awardedAt: '2026-10-20T10:00:00+09:00', rbidNo: null }] : [], op: bizNo ? 'getScsbidListSttusServc' : null, fetchedAt: NOW.toISOString() });
const prevOf = (o: Partial<ResultEntry> = {}): ResultEntry => ({
  noticeId: 'R26BK00000001-000', noticeNo: 'R26BK00000001', round: '000', status: 'waiting',
  openingAt: new Date(NOW.getTime() - 2 * H).toISOString(), startAt: new Date(NOW.getTime() - 2 * H).toISOString(),
  attempts: 0, nextCheckAt: NOW.toISOString(), ...o,
});
const j = (o: { prev?: ResultEntry; opening: OpeningResult; award?: AwardResult | null }) =>
  judge({ ourBizNo: OURS, now: NOW, prev: o.prev ?? prevOf(), opening: o.opening, award: o.award ?? null });

describe('judge', () => {
  it('규칙1: 오류는 상태 유지, attempts+1, backoff', () => {
    const r = j({ prev: prevOf({ status: 'ranked', attempts: 1 }), opening: { ok: false, error: { code: 'G2B_NETWORK', message: 'x', step: 'fetch_basic', retryable: true } } });
    expect(r.entry).toMatchObject({ status: 'ranked', attempts: 2, lastError: { code: 'G2B_NETWORK' } });
    expect(r.entry.nextCheckAt).toBe(new Date(NOW.getTime() + 2 * H).toISOString());
    expect(r.event).toBeUndefined();
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n) / MIN)).toEqual([30, 120, 360, 1440, 1440]);
  });

  it('규칙2: 1순위여도 2단계 없으면 ranked', () => {
    const r = j({ opening: opening([row(OURS, 1), row('999', 2)]), award: award(null) });
    expect(r.entry).toMatchObject({ status: 'ranked', rank: 1, bidders: 2 });
    expect(r.event).toBe('rank');
  });

  it('규칙2: 2순위여도 2단계에서 우리면 won', () => {
    const r = j({ opening: opening([row('999', 1), row(OURS, 2)]), award: award(OURS, '우리') });
    expect(r.entry).toMatchObject({ status: 'won', rank: 2, amount: 5000, awardedAt: '2026-10-20T10:00:00+09:00', listOp: 'getScsbidListSttusServc' });
    expect(r.event).toBe('final');
  });

  it('규칙2: 1순위여도 2단계에서 타사면 lost', () => {
    const r = j({ prev: prevOf({ status: 'ranked', rank: 1 }), opening: opening([row(OURS, 1), row('999', 2)]), award: award('9998887776', '타사') });
    expect(r.entry).toMatchObject({ status: 'lost', winnerBizNo: '9998887776', winnerName: '타사', rank: 1 });
    expect(r.event).toBe('final');
  });

  it('규칙3/4: 1단계 플래그가 있으면 won/no_bid', () => {
    expect(j({ opening: opening([row(OURS, 1, { won: true })]) }).entry.status).toBe('won');
    expect(j({ opening: opening([row('999', null, { noBid: true })]) }).entry.status).toBe('no_bid');
  });

  it('규칙5: 순위/점수 모두 null이면 waiting', () => {
    const r = j({ opening: opening([row(OURS, null), row('999', null)]) });
    expect(r.entry).toMatchObject({ status: 'waiting', bidders: 2, attempts: 1 });
    expect(r.event).toBeUndefined();
  });

  it('규칙6: 우리가 없으면 not_participated', () => {
    const r = j({ opening: opening([row('999', 1), row('888', 2)]) });
    expect(r.entry.status).toBe('not_participated');
    expect(r.event).toBe('final');
  });

  it('규칙8: 121일 지나면 expired, 120일 이내는 유지', () => {
    const old = prevOf({ openingAt: new Date(NOW.getTime() - 121 * 24 * H).toISOString() });
    const r = j({ prev: old, opening: opening([]) });
    expect(r.entry.status).toBe('expired');
    expect(r.event).toBe('expired');
    expect(j({ prev: prevOf({ openingAt: new Date(NOW.getTime() - 119 * 24 * H).toISOString() }), opening: opening([]) }).entry.status).toBe('waiting');
  });

  it('같은 상태 반복은 이벤트 없음, rbidNo는 최대 묶음만', () => {
    expect(j({ prev: prevOf({ status: 'ranked' }), opening: opening([row(OURS, 1)]) }).event).toBeUndefined();
    const r = j({ opening: opening([row(OURS, 1, { rbidNo: '0' }), row('999', 1, { rbidNo: '1' })]) });
    expect(r.entry.status).toBe('not_participated');
  });

  it('fillScoreRanks: 순위가 없고 점수만 있으면 점수 내림차순으로 채운다(동점은 같은 순위)', () => {
    const r = (b: string, s: number | null): OpeningRow => ({ ...row(b, null), totalScore: s });
    expect(fillScoreRanks([r('1', 90), r('2', 95), r('3', 90), r('4', null)]).map((x) => x.rank)).toEqual([2, 1, 2, null]);
    expect(fillScoreRanks([row('1', 3), r('2', 95)]).map((x) => x.rank)).toEqual([3, null]); // 순위가 하나라도 있으면 그대로
  });

  it('점수만 있는 응답은 최신 rbidNo 묶음 안에서 순위를 매기고 rank 이벤트가 난다', () => {
    const r = (b: string, s: number, rbidNo: string): OpeningRow => ({ ...row(b, null), totalScore: s, rbidNo });
    const out = j({ opening: opening([r(OURS, 80, '1'), r('999', 99, '0'), r('888', 70, '1')]) });
    expect(out.entry).toMatchObject({ status: 'ranked', rank: 1, bidders: 2 }); // 묶음 1에서는 80점이 1위
    expect(out.event).toBe('rank');
  });

  it('shouldFetchAward: ranked이거나 빈 배열+listOp일 때만, not_participated는 아님', () => {
    const p = prevOf();
    const o1 = opening([row(OURS, 1)]);
    expect(shouldFetchAward(p, o1, j({ opening: o1 }).entry, OURS)).toBe(true);
    const o2 = opening([row('999', 1)]);
    expect(shouldFetchAward(p, o2, j({ opening: o2 }).entry, OURS)).toBe(false);
    const o3 = opening([]);
    expect(shouldFetchAward(p, o3, j({ opening: o3 }).entry, OURS)).toBe(false);
    expect(shouldFetchAward(prevOf({ listOp: 'x' }), o3, j({ opening: o3 }).entry, OURS)).toBe(true);
    // 이전이 ranked면 1단계 결과와 무관하게 호출
    expect(shouldFetchAward(prevOf({ status: 'ranked' }), o2, j({ opening: o2 }).entry, OURS)).toBe(true);
  });
});

const ie = (id: string, o: Partial<IndexEntry> = {}): IndexEntry => {
  const [no, round] = [id.slice(0, 13), id.slice(14)];
  return { noticeId: id, noticeNo: no, round, title: id, orderingOrg: '', folder: `notices/${id}`, collectedAt: '', collectStatus: 'ok', attachments: { total: 0, saved: 0, failed: 0 }, extractionStatus: 'not_run', mailStatus: 'none', isCorrection: false, ...o } as unknown as IndexEntry;
};
const rf = (entries: ResultEntry[], bizNo = OURS): ResultFile => ({ schemaVersion: 1, bizNo, updatedAt: '', entries: Object.fromEntries(entries.map((e) => [e.noticeId, e])) });
const ff: FollowFile = { schemaVersion: 1, updatedAt: '', entries: {} };

describe('ourAmount와 applyOurAmount', () => {
  it('won/lost/ranked는 ourAmount를 설정하고 not_participated는 설정하지 않는다', () => {
    const won = j({ opening: opening([row('999', 1), row(OURS, 2, { bidAmount: 700 })]), award: award(OURS, '우리') });
    expect(won.entry).toMatchObject({ status: 'won', ourAmount: 700 });
    const lost = j({ opening: opening([row(OURS, 2, { bidAmount: 800 }), row('999', 1)]), award: award('999') });
    expect(lost.entry).toMatchObject({ status: 'lost', ourAmount: 800 });
    const ranked = j({ opening: opening([row(OURS, 1, { bidAmount: 900 }), row('999', 2)]), award: award(null) });
    expect(ranked.entry).toMatchObject({ status: 'ranked', ourAmount: 900 });
    const np = j({ opening: opening([row('999', 1, { bidAmount: 5 })]) });
    expect(np.entry.status).toBe('not_participated');
    expect(np.entry.ourAmount).toBeUndefined();
  });

  it('ranked에서 120일이 지나 expired가 돼도 ourAmount를 유지한다', () => {
    const prev = prevOf({ status: 'ranked', openingAt: new Date(NOW.getTime() - 121 * 24 * H).toISOString() });
    const r = j({ prev, opening: opening([row(OURS, 1, { bidAmount: 900 }), row('999', 2)]), award: award(null) });
    expect(r.entry).toMatchObject({ status: 'expired', rank: 1, ourAmount: 900 });
  });

  it('재판정 시 prev.ourAmount를 지운 뒤 새 값으로 다시 설정하고 amountCheckedAt은 보존한다', () => {
    const prev = prevOf({ status: 'ranked', ourAmount: 111, amountCheckedAt: 'x' });
    const r = j({ prev, opening: opening([row(OURS, 1, { bidAmount: 222 }), row('999', 2)]), award: award(null) });
    expect(r.entry).toMatchObject({ ourAmount: 222, amountCheckedAt: 'x' });
    const r2 = j({ prev, opening: opening([row(OURS, 1), row('999', 2)]), award: award(null) });
    expect(r2.entry.ourAmount).toBeUndefined();
  });

  it('applyOurAmount: 상태 계열은 그대로, ourAmount와 amountCheckedAt만 채운다', () => {
    const prev = prevOf({ status: 'lost', rank: 2, winnerBizNo: '999', amount: 50, nextCheckAt: 'N', attempts: 0 });
    const out = applyOurAmount(prev, [row(OURS, 2, { bidAmount: 123 }), row('999', 1)], OURS, 'T');
    expect(out).toEqual({ ...prev, ourAmount: 123, bidders: 2, amountCheckedAt: 'T' });
  });

  it('applyOurAmount: 우리 행이 없어도 amountCheckedAt은 기록하고, bidders가 있으면 덮지 않는다', () => {
    const prev = prevOf({ status: 'lost', bidders: 9 });
    const out = applyOurAmount(prev, [row('999', 1, { bidAmount: 5 })], OURS, 'T');
    expect(out).toEqual({ ...prev, amountCheckedAt: 'T' });
    expect(applyOurAmount(prev, [], OURS, 'T').bidders).toBe(9);
  });
});

describe('plan', () => {
  it('newEntry: openingAt, 없으면 bidCloseAt, 둘 다 없으면 null, 첫 확인은 +30분', () => {
    const base = { noticeId: 'a', noticeNo: 'a', round: '000', proposalEvalAt: null };
    const e = newEntry({ ...base, openingAt: '2026-10-20T10:00:00+09:00', bidCloseAt: null })!;
    expect(e.nextCheckAt).toBe(new Date(Date.parse('2026-10-20T10:30:00+09:00')).toISOString());
    expect(newEntry({ ...base, openingAt: null, bidCloseAt: '2026-10-19T10:00:00+09:00' })!.openingAt).toBe('2026-10-19T10:00:00+09:00');
    expect(newEntry({ ...base, openingAt: null, bidCloseAt: null })).toBeNull();
  });

  it('resetForBiz: 사업자번호가 바뀌면 전부 초기화', () => {
    const f = resetForBiz(rf([prevOf({ status: 'won', rank: 1, attempts: 3 })], '0000000000'), OURS, NOW);
    expect(f.bizNo).toBe(OURS);
    expect(Object.values(f.entries)[0]).toMatchObject({ status: 'waiting', attempts: 0, nextCheckAt: NOW.toISOString() });
    expect(Object.values(f.entries)[0]!.rank).toBeUndefined();
  });

  it('resetForBiz: ourAmount와 amountCheckedAt도 제거', () => {
    const f = resetForBiz(rf([prevOf({ status: 'won', ourAmount: 5, amountCheckedAt: 'T' })], '0000000000'), OURS, NOW);
    const e = Object.values(f.entries)[0]!;
    expect(e.ourAmount).toBeUndefined();
    expect(e.amountCheckedAt).toBeUndefined();
  });

  it('backfillTargets: 상한 10, 조건 필터, openingAt 내림차순', () => {
    const idx = (no: string, round = '000', kind?: 'prespec'): IndexEntry => ({ noticeId: `${no}-${round}`, noticeNo: no, round, ...(kind ? { kind } : {}) }) as unknown as IndexEntry;
    const ent = (no: string, o: Partial<ResultEntry>): ResultEntry => prevOf({ noticeId: `${no}-000`, noticeNo: no, ...o });
    const day = (n: number) => new Date(2026, 5, n).toISOString();
    const nos = Array.from({ length: 12 }, (_, i) => `N${String(i).padStart(2, '0')}`);
    const index = [...nos.map((n) => idx(n)), idx('EXP'), idx('EXPR'), idx('HAS'), idx('CHK'), idx('PRE', '000', 'prespec'), idx('OLD', '000'), idx('OLD', '001'), idx('RK')];
    const entries = [
      ...nos.map((n, i) => ent(n, { status: i % 2 ? 'won' : 'lost', openingAt: day(i + 1) })),
      ent('EXP', { status: 'expired', openingAt: day(20) }),
      ent('EXPR', { status: 'expired', rank: 3, openingAt: day(10) }),
      ent('HAS', { status: 'won', ourAmount: 1, openingAt: day(25) }),
      ent('CHK', { status: 'won', amountCheckedAt: 'T', openingAt: day(26) }),
      ent('PRE', { status: 'won', openingAt: day(27) }),
      ent('OLD', { status: 'won', openingAt: day(28) }),
      ent('RK', { status: 'ranked', rank: 1, openingAt: day(29) }),
    ];
    const t = backfillTargets(index, rf(entries));
    expect(t).toHaveLength(10);
    expect(t.slice(0, 3)).toEqual(['N11-000', 'N10-000', 'N09-000']);
    expect(t).toContain('EXPR-000');
    for (const x of ['EXP-000', 'HAS-000', 'CHK-000', 'PRE-000', 'OLD-000', 'RK-000']) expect(t).not.toContain(x);
    expect(backfillTargets([idx('OLD', '000'), idx('OLD', '001')], rf([ent('OLD', { status: 'won' })]))).toEqual([]);
  });

  it('resetForBiz: bizNo가 비어 있는 파일은 그대로 둔다', () => {
    const f = rf([prevOf({ attempts: 2, nextCheckAt: 'later' })], '');
    expect(resetForBiz(f, OURS, NOW)).toBe(f);
  });

  it('planTargets: 000/001 중 001, 사전규격 제외, index에 없으면 prune, 결과 없으면 needOpening', () => {
    const index = [ie('R26BK00000001-000'), ie('R26BK00000001-001'), ie('R26BK00000002-000', { kind: 'prespec' })];
    const r = rf([prevOf({ noticeId: 'R26BK00000001-001', openingAt: NOW.toISOString() }), prevOf({ noticeId: 'GONE-000' })]);
    const p = planTargets({ index, results: r, follows: ff, now: NOW, mode: 'list' });
    expect(p.targets).toEqual(['R26BK00000001-001']);
    expect(p.prune).toEqual(['GONE-000']);
    expect(p.needOpening).toEqual([]);
    expect(planTargets({ index, results: rf([]), follows: ff, now: NOW, mode: 'list' }).needOpening.map((e) => e.noticeId)).toEqual(['R26BK00000001-001']);
  });
});
