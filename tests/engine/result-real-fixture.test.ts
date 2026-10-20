import { describe, expect, it } from 'vitest';
import type { FollowFile, ResultFile } from '../../src/core/types/result';
import { runResultRefresh } from '../../src/engine/results/result-tracker';
import { fakeG2b, NOW, seedStore } from '../helpers/result-fixture';
import type { MemoryStore } from '../helpers/memory-store';

// S0 실측 응답 기반 회귀 테스트. 우리 사업자번호는 5978600662.
const OURS = '5978600662';
const PAST = '2026-10-20T09:00:00+09:00';
const rj = (s: MemoryStore): ResultFile => JSON.parse(s.files.get('results.json') as string);
const fj = (s: MemoryStore): FollowFile => JSON.parse(s.files.get('follows.json') as string);

const common = { opengRsltDivNm: '개찰완료', bidNtceOrd: '000', rbidNo: '000' };

function setup(noticeNo: string, followed: boolean): { store: MemoryStore; id: string } {
  const id = `${noticeNo}-000`;
  const store = seedStore([{ id, openingAt: PAST }]);
  store.files.set('results.json', JSON.stringify({
    schemaVersion: 1, bizNo: OURS, updatedAt: '',
    entries: { [id]: { noticeId: id, noticeNo, round: '000', status: 'waiting', openingAt: PAST, startAt: new Date(PAST).toISOString(), attempts: 0, nextCheckAt: PAST } },
  }));
  if (followed) store.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [id]: { noticeId: id, followedAt: PAST, notified: {} } } }));
  return { store, id };
}

const run = (store: MemoryStore, fetchFn: typeof fetch) =>
  runResultRefresh({ store, fetch: fetchFn, serviceKey: 'KEY', bizNo: '597-86-00662', now: () => NOW, checkPermission: async () => true }, { mode: 'list' });

describe('실측 응답 회귀', () => {
  it('A 낙찰: 2단계에서 우리가 낙찰업체면 won', async () => {
    const { store, id } = setup('R26BK01631407', true);
    const g = fakeG2b((op) => {
      if (op === 'getOpengResultListInfoOpengCompt') return [
        { ...common, opengRank: '1', prcbdrBizno: '5978600662', prcbdrNm: '주식회사 엑스코어시스템', bidprcAmt: '291990000', totalEvlAmtVal: '99.7949' },
        { ...common, opengRank: '2', prcbdrBizno: '1198633696', prcbdrNm: '주식회사 웹프라자', totalEvlAmtVal: '94.135' },
      ];
      if (op === 'getScsbidListSttusServc') return [{ bidNtceNo: 'R26BK01631407', bidNtceOrd: '000', rbidNo: '000', bidwinnrNm: '주식회사 엑스코어시스템', bidwinnrBizno: '5978600662', sucsfbidAmt: '291990000', sucsfbidRate: '', fnlSucsfDate: '2026-08-20', rlOpengDt: '2026-08-18 10:56:47', prtcptCnum: '2' }];
      return [];
    });
    const r = await run(store, g.fetch);
    expect(rj(store).entries[id]).toMatchObject({ status: 'won', rank: 1, amount: 291990000, ourAmount: 291990000, listOp: 'getScsbidListSttusServc' });
    expect(rj(store).entries[id]!.awardedAt).toMatch(/^2026-08-20/);
    expect(rj(store).entries[id]!.awardedAt).toContain('+09:00');
    expect(r.events).toMatchObject([{ kind: 'final', status: 'won', noticeId: id }]);
    expect(fj(store).entries[id]).toBeUndefined();
  });

  it('B 탈락: 2단계 낙찰업체가 타사면 lost', async () => {
    const { store, id } = setup('R26BK01379504', true);
    const g = fakeG2b((op) => {
      if (op === 'getOpengResultListInfoOpengCompt') return [
        { ...common, opengRank: '1', prcbdrBizno: '1478602432', prcbdrNm: '(주)나라원시스템', totalEvlAmtVal: '98.0052' },
        { ...common, opengRank: '2', prcbdrBizno: '5978600662', prcbdrNm: '주식회사 엑스코어시스템', totalEvlAmtVal: '98' },
        { ...common, opengRank: '3', prcbdrBizno: '1438133020', prcbdrNm: '다른회사', totalEvlAmtVal: '97.0092' },
      ];
      if (op === 'getScsbidListSttusServc') return [{ bidNtceNo: 'R26BK01379504', bidNtceOrd: '000', rbidNo: '000', bidwinnrBizno: '1478602432', bidwinnrNm: '(주)나라원시스템', sucsfbidAmt: '880440000', fnlSucsfDate: '2026-04-22' }];
      return [];
    });
    const r = await run(store, g.fetch);
    expect(rj(store).entries[id]).toMatchObject({ status: 'lost', rank: 2, winnerName: '(주)나라원시스템', winnerBizNo: '1478602432' });
    expect(r.events).toMatchObject([{ kind: 'final', status: 'lost', winnerName: '(주)나라원시스템' }]);
    expect(fj(store).entries[id]).toBeUndefined();
  });

  it('C 개찰 전: 1단계와 2단계가 모두 비면 waiting, 이벤트와 오류 없음', async () => {
    const { store, id } = setup('R26BK01722175', true);
    const g = fakeG2b(() => []);
    const r = await run(store, g.fetch);
    expect(rj(store).entries[id]).toMatchObject({ status: 'waiting' });
    expect(rj(store).entries[id]!.lastError).toBeUndefined();
    expect(r.events).toEqual([]);
    expect(r.error).toBeUndefined();
    expect(fj(store).entries[id]).toBeDefined();
  });
});
