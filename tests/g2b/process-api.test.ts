import { describe, expect, it } from 'vitest';
import { PROCESS_OPS, fetchProcess, mapProcess, parseCaretList } from '../../src/adapters/g2b/process-api';
import fx from '../fixtures/g2b-process-R26BK01470335.json';

const NO = 'R26BK01470335';
const items = (fx as { response: { body: { items: Array<Record<string, string>> } } }).response.body.items;
const ok = (list: unknown[]) => ({ status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items: list } } }) }) as Response;

describe('parseCaretList', () => {
  it('빈 문자열은 []', () => {
    expect(parseCaretList('')).toEqual([]);
    expect(parseCaretList('  ')).toEqual([]);
  });
  it('항목 하나', () => expect(parseCaretList('[1^a^b]')).toEqual([['1', 'a', 'b']]));
  it('항목 둘', () => expect(parseCaretList('[1^a],[2^b]')).toEqual([['1', 'a'], ['2', 'b']]));
  it('칸 앞뒤 공백 trim', () => expect(parseCaretList('[ 1 ^ a b ]')).toEqual([['1', 'a b']]));
});

describe('mapProcess', () => {
  it('픽스처', () => {
    const out = mapProcess(items)!;
    expect(out.rounds.map((r) => r.round)).toEqual(['000', '001']);
    expect(out.rounds[0]!.winners).toEqual([]);
    expect(out.rounds[0]!.contracts).toEqual([]);
    const r1 = out.rounds[1]!;
    expect(r1.winners).toHaveLength(1);
    expect(r1.winners[0]).toMatchObject({ name: '주식회사 티에스산업', bizNo: '1308190194', amount: 209487800, rate: 86.869, bidders: 30 });
    expect(typeof r1.winners[0]!.openedAt).toBe('string');
    expect(r1.contracts.map((c) => c.contractNo)).toEqual(['R26TA0182919201', 'R26TA0182919200']);
    expect(r1.contracts.map((c) => c.amount)).toEqual([199180500, 209487800]);
    expect(r1.contracts.every((c) => typeof c.contractedAt === 'string')).toBe(true);
    expect(JSON.stringify(out).includes('홍길동')).toBe(false);
    expect(out.orderPlan!.no).toBe('R26DD20731442');
    expect(out.prespec!.regNo).toBe('R26BD00205777');
  });
  it('빈 배열은 null', () => expect(mapProcess([])).toBeNull());
  it('orderPlanNo가 비면 orderPlan null', () => {
    expect(mapProcess([{ ...items[0]!, orderPlanNo: '' }])!.orderPlan).toBeNull();
  });
});

describe('fetchProcess', () => {
  const row = (over: Record<string, string> = {}) => ({ ...items[0]!, ...over });
  it('Servc 0건, Thng 1건이면 Thng에서 멈춘다', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return ok(u.includes('Thng') ? [row()] : []); }) as unknown as typeof fetch;
    const r = await fetchProcess(NO, PROCESS_OPS, { serviceKey: 'K', fetch: f });
    expect(r).toMatchObject({ ok: true, op: 'getCntrctProcssIntgOpenThng' });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('inqryDiv=1');
    expect(urls[0]).toContain(`bidNtceNo=${NO}`);
  });
  it('Servc 오류는 즉시 실패', async () => {
    let n = 0;
    const f = (async () => { n++; throw new Error('net'); }) as unknown as typeof fetch;
    expect(await fetchProcess(NO, PROCESS_OPS, { serviceKey: 'K', fetch: f })).toMatchObject({ ok: false });
    expect(n).toBe(1);
  });
  it('전부 0건이면 items [] op null, 4회 호출', async () => {
    let n = 0;
    const f = (async () => { n++; return ok([]); }) as unknown as typeof fetch;
    expect(await fetchProcess(NO, PROCESS_OPS, { serviceKey: 'K', fetch: f })).toMatchObject({ ok: true, items: [], op: null });
    expect(n).toBe(4);
  });
  it('키가 비면 G2B_KEY_MISSING, 호출 0회', async () => {
    let n = 0;
    const f = (async () => { n++; return ok([]); }) as unknown as typeof fetch;
    const r = await fetchProcess(NO, PROCESS_OPS, { serviceKey: '', fetch: f });
    expect(r).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
    expect(n).toBe(0);
  });
  it('ops 1개만 주면 그 op만 호출', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return ok([]); }) as unknown as typeof fetch;
    await fetchProcess(NO, [PROCESS_OPS[2]], { serviceKey: 'K', fetch: f });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(PROCESS_OPS[2]);
  });
  it('다른 bidNtceNo 행은 버려진다', async () => {
    const f = (async () => ok([row(), row({ bidNtceNo: 'R26BK00000000' })])) as unknown as typeof fetch;
    const r = await fetchProcess(NO, PROCESS_OPS, { serviceKey: 'K', fetch: f });
    expect(r.ok && r.items).toHaveLength(1);
  });
});
