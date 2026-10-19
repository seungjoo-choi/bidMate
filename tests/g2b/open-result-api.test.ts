import { describe, expect, it } from 'vitest';
import { fetchOfficialResult, mapOfficialRows } from '../../src/adapters/g2b/open-result-api';

const ITEMS = [
  { opengRank: '1', prcbdrBizno: '597-86-00662', bidprcAmt: '291990000', bidPrceEvlVal: '9.7949', techEvlVal: '90', totalEvlAmtVal: '99.7949', techEvlNaturVal: '85.245' },
  { opengRank: '2', prcbdrBizno: '1198633696', bidprcAmt: '286000000', bidPrceEvlVal: '10', techEvlVal: '84.135', totalEvlAmtVal: '94.135', techEvlNaturVal: '79.38' },
];
const body = (items: unknown) => ({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items } } });

describe('open-result-api', () => {
  it('mapOfficialRows: 숫자 변환과 사업자번호 숫자만', () => {
    expect(mapOfficialRows(ITEMS)).toEqual([
      { bizNo: '5978600662', rank: 1, bidAmount: 291990000, priceScore: 9.7949, techScore: 90, totalScore: 99.7949, techRaw: 85.245 },
      { bizNo: '1198633696', rank: 2, bidAmount: 286000000, priceScore: 10, techScore: 84.135, totalScore: 94.135, techRaw: 79.38 },
    ]);
    expect(mapOfficialRows([{ prcbdrBizno: '1' }])[0]).toMatchObject({ rank: null, bidAmount: null });
  });

  it('mapOfficialRows: 차수가 다른 행과 사업자번호가 빈 행을 제외한다', () => {
    const rows = mapOfficialRows([
      { ...ITEMS[0]!, bidNtceOrd: '000' },
      { ...ITEMS[1]!, bidNtceOrd: '001' },
      { opengRank: '3', prcbdrBizno: '', bidNtceOrd: '000' },
      { ...ITEMS[1]! }, // 차수 없음: 유지
    ], '000');
    expect(rows.map((r) => r.bizNo)).toEqual(['5978600662', '1198633696']);
  });

  it('fetchOfficialResult: 요청 URL과 결과', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return { status: 200, text: async () => JSON.stringify(body(ITEMS)) } as Response; }) as unknown as typeof fetch;
    const r = await fetchOfficialResult('R26BK01631407', '000', { serviceKey: 'KEY', fetch: f, now: () => new Date('2026-10-19T00:00:00Z') });
    expect(url).toContain('getOpengResultListInfoOpengCompt');
    expect(url).toContain('inqryDiv=4');
    expect(url).toContain('bidNtceNo=R26BK01631407');
    expect(r).toMatchObject({ ok: true, fetchedAt: '2026-10-19T00:00:00.000Z' });
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it('서비스키가 없으면 G2B_KEY_MISSING, API 오류는 키를 가린다', async () => {
    const f = (async () => ({ status: 500, text: async () => 'KEY boom' }) as Response) as unknown as typeof fetch;
    expect(await fetchOfficialResult('R26BK01631407', '000', { fetch: f })).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
    const r = await fetchOfficialResult('R26BK01631407', '000', { serviceKey: 'KEY', fetch: f });
    expect(r).toMatchObject({ ok: false, error: { code: 'G2B_API_ERROR' } });
  });
});
