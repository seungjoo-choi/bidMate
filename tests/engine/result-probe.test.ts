import { describe, expect, it } from 'vitest';
import { AWARD_OPS, FAILING_OPS } from '../../src/adapters/g2b/award-api';
import { probeResult } from '../../src/engine/results/result-probe';

const ok = (items: unknown) => ({ status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items } } }) }) as Response;

describe('probeResult 단계 호출', () => {
  it('공고정보 1회, 개찰결과 1회, 유찰 목록 op 수, 낙찰정보 4회를 호출한다', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return u.includes('getBidPblancListInfoServc') ? ok([{ bidNtceNo: 'R1', bidNtceOrd: '000', reNtceYn: 'N' }]) : ok([]); }) as unknown as typeof fetch;
    const r = await probeResult('R26BK01789254', 'KEY', f);
    expect(urls.filter((u) => u.includes('getBidPblancListInfo'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('OpengCompt'))).toHaveLength(1);
    expect(urls.filter((u) => FAILING_OPS.some((op) => u.includes(op)))).toHaveLength(FAILING_OPS.length);
    expect(urls.filter((u) => u.includes('getScsbidListSttus'))).toHaveLength(AWARD_OPS.length);
    expect(r.notice).toMatchObject({ ok: true, count: 1, op: 'getBidPblancListInfoServc' });
    expect(r.notice.keys).toEqual(['bidNtceNo', 'bidNtceOrd', 'reNtceYn']);
    expect(r.failing.map((x) => x.op)).toEqual([...FAILING_OPS]);
  });

  it('한 op가 실패해도 나머지를 호출하고 키는 error에서 마스킹한다', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (FAILING_OPS.some((op) => u.includes(op))) throw new Error('boom serviceKey=SECRET');
      return ok([]);
    }) as unknown as typeof fetch;
    const r = await probeResult('R26BK01789254', 'SECRET', f);
    expect(r.failing[0]!.ok).toBe(false);
    expect(r.failing[0]!.error).not.toContain('SECRET');
    expect(r.notice).toMatchObject({ ok: false, op: null });
    expect(urls.filter((u) => u.includes('getScsbidListSttus'))).toHaveLength(AWARD_OPS.length);
  });
});
