import { describe, expect, it } from 'vitest';
import { AWARD_OPS, fetchAward, fetchAwardRaw, fetchOpening, fetchOpeningRaw, mapAwardRows, mapOpeningRows } from '../../src/adapters/g2b/award-api';
import { probeResult } from '../../src/engine/results/result-probe';

const body = (items: unknown) => ({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items } } });
const ok = (items: unknown) => ({ status: 200, text: async () => JSON.stringify(body(items)) }) as Response;

describe('award-api', () => {
  it('fetchOpeningRaw: inqryDiv=4, bidNtceNo, 키 포함', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return ok([{ a: '1' }]); }) as unknown as typeof fetch;
    const r = await fetchOpeningRaw('R26BK01631407', { serviceKey: 'KEY', fetch: f });
    expect(url).toContain('getOpengResultListInfoOpengCompt');
    expect(url).toContain('inqryDiv=4');
    expect(url).toContain('bidNtceNo=R26BK01631407');
    expect(url).toContain('serviceKey=KEY');
    expect(r).toMatchObject({ ok: true });
  });

  it('fetchAwardRaw: inqryDiv=4와 op', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return ok([]); }) as unknown as typeof fetch;
    await fetchAwardRaw('R26BK01631407', AWARD_OPS[1], { serviceKey: 'KEY', fetch: f });
    expect(url).toContain('getScsbidListSttusThng');
    expect(url).toContain('inqryDiv=4');
    expect(url).toContain('bidNtceNo=R26BK01631407');
  });

  it('키가 없으면 G2B_KEY_MISSING', async () => {
    const f = (async () => ok([])) as unknown as typeof fetch;
    const a = await fetchOpeningRaw('R26BK01631407', { fetch: f });
    const b = await fetchAwardRaw('R26BK01631407', AWARD_OPS[0], { serviceKey: ' ', fetch: f });
    expect(a).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
    expect(b).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
  });
});

describe('probeResult', () => {
  it('4개 op를 모두 호출하고 한 op가 실패해도 계속한다', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (u.includes('Thng')) throw new Error('boom serviceKey=SECRET');
      if (u.includes('Servc')) return ok([{ b: '1', a: '2' }, { c: '3' }, { a: '1' }, { a: '4' }]);
      return ok([]);
    }) as unknown as typeof fetch;
    const r = await probeResult('R26BK01631407', 'SECRET', f);
    expect(urls).toHaveLength(5);
    expect(urls.filter((u) => u.includes('inqryDiv=4') && !u.includes('OpengCompt'))).toHaveLength(4);
    expect(r.opening).toMatchObject({ ok: true, count: 0 });
    expect(r.award.map((a) => a.op)).toEqual([...AWARD_OPS]);
    expect(r.award[0]).toMatchObject({ ok: true, count: 4, keys: ['a', 'b', 'c'] });
    expect(r.award[0]!.sample).toHaveLength(3);
    expect(r.award[1]!.ok).toBe(false);
    expect(r.award[1]!.error).not.toContain('SECRET');
    expect(r.award[2]).toMatchObject({ ok: true, count: 0 });
  });
});

describe('award-api 매핑과 순회', () => {
  it('mapOpeningRows: 하이픈 제거, 빈 사업자번호 제외, rank null', () => {
    const rows = mapOpeningRows([
      { prcbdrBizno: '597-86-00662', opengRank: '1', totalEvlAmtVal: '99.5', rbidNo: '1', bidprcAmt: '291,990,000' },
      { prcbdrBizno: '1198633696', bidprcAmt: ' ' },
      { prcbdrBizno: '', opengRank: '3' },
    ]);
    expect(rows).toEqual([
      { bizNo: '5978600662', rank: 1, totalScore: 99.5, rbidNo: '1', bidAmount: 291990000, won: null, noBid: null },
      { bizNo: '1198633696', rank: null, totalScore: null, rbidNo: null, bidAmount: null, won: null, noBid: null },
    ]);
  });

  it('mapAwardRows: 하이픈 제거, 금액, 날짜 변환, 빈 사업자번호 제외', () => {
    const rows = mapAwardRows([
      { bidwinnrBizno: '597-86-00662', bidwinnrNm: '우리', sucsfbidAmt: '1,000', fnlSucsfDate: '2026-10-20 10:30:00' },
      { bidwinnrBizno: '' },
    ]);
    expect(rows).toEqual([{ bizNo: '5978600662', name: '우리', amount: 1000, awardedAt: '2026-10-20T10:30:00+09:00', rbidNo: null }]);
  });

  it('fetchOpening: 행과 fetchedAt', async () => {
    const f = (async () => ok([{ prcbdrBizno: '1234567890', opengRank: '1' }])) as unknown as typeof fetch;
    const r = await fetchOpening('R26BK01631407', { serviceKey: 'K', fetch: f, now: () => new Date('2026-10-20T00:00:00Z') });
    expect(r).toMatchObject({ ok: true, fetchedAt: '2026-10-20T00:00:00.000Z' });
  });

  it('fetchAward: 첫 비어 있지 않은 op에서 멈춘다', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return ok(u.includes('Thng') ? [{ bidwinnrBizno: '1234567890' }] : []); }) as unknown as typeof fetch;
    const r = await fetchAward('R26BK01631407', AWARD_OPS, { serviceKey: 'K', fetch: f });
    expect(urls).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, op: 'getScsbidListSttusThng' });
  });

  it('fetchAward: 오류는 즉시 반환, 모두 비면 rows [] op null', async () => {
    let n = 0;
    const bad = (async () => { n++; throw new Error('net'); }) as unknown as typeof fetch;
    expect(await fetchAward('R26BK01631407', AWARD_OPS, { serviceKey: 'K', fetch: bad })).toMatchObject({ ok: false });
    expect(n).toBe(1);
    const empty = (async () => ok([])) as unknown as typeof fetch;
    expect(await fetchAward('R26BK01631407', AWARD_OPS, { serviceKey: 'K', fetch: empty })).toMatchObject({ ok: true, rows: [], op: null });
  });
});
