import { describe, expect, it } from 'vitest';
import { ORG_OPS, probeOrg } from '../../src/adapters/g2b/org-api';

const ok = (items: unknown[]) => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: items.length === 1 ? { item: items[0] } : { item: items }, totalCount: items.length } } });
const P = { orgCode: 'Z004560', kind: 'Servc' as const, from: '202609220000', to: '202610222359' };

function fake(bodyOf: (url: string) => string) {
  const urls: string[] = [];
  const fetch = (async (url: string) => { urls.push(url); return new Response(bodyOf(url)); }) as unknown as typeof globalThis.fetch;
  return { urls, ctx: { serviceKey: 'KEY', fetch } };
}

describe('probeOrg', () => {
  it('정상: 단계별 count·keys·sample 3건, 기본 오퍼레이션은 kind로 치환', async () => {
    const f = fake((u) => (u.includes('ScsbidInfoService')
      ? ok([{ bidNtceNo: 'A', sucsfbidRate: '88.1', presmptPrce: '100' }])
      : ok([1, 2, 3, 4].map((n) => ({ bidNtceNo: `N${n}`, dminsttCd: 'Z004560' })))));
    const r = await probeOrg(P, f.ctx);
    expect(r.notice).toMatchObject({ ok: true, count: 4, keys: ['bidNtceNo', 'dminsttCd'], op: 'getBidPblancListInfoServcPPSSrch' });
    expect(r.notice.sample).toHaveLength(3);
    expect(r.award).toMatchObject({ ok: true, count: 1, op: 'getScsbidListSttusServcPPSSrch' });
    expect(r.award.keys).toContain('sucsfbidRate');
    expect(typeof r.award.ms).toBe('number');
    expect(f.urls).toHaveLength(2);
    expect(f.urls[0]).toContain('dminsttCd=Z004560');
    expect(f.urls[0]).toContain('inqryBgnDt=202609220000');
    expect(f.urls[0]).toContain('inqryDiv=1');
    expect(ORG_OPS.noticeSearch).toContain('{Kind}');
  });

  it('오류: 한 단계가 실패해도 다른 단계는 진행하고 키는 가린다', async () => {
    const f = fake((u) => (u.includes('ScsbidInfoService')
      ? JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' } } })
      : ok([{ a: '1' }])));
    const r = await probeOrg(P, f.ctx);
    expect(r.notice.ok).toBe(true);
    expect(r.award.ok).toBe(false);
    expect(r.award.error).toContain('G2B_RATE_LIMIT');
    expect(r.award.error).not.toContain('KEY');
  });

  it('오퍼레이션 이름 덮어쓰기', async () => {
    const f = fake(() => ok([]));
    const r = await probeOrg({ ...P, kind: 'Thng', noticeOp: 'myNoticeOp', awardOp: 'myAwardOp' }, f.ctx);
    expect(r.notice).toMatchObject({ op: 'myNoticeOp', ok: true, count: 0 });
    expect(r.award.op).toBe('myAwardOp');
    expect(f.urls[0]).toContain('/myNoticeOp?');
    expect(f.urls[1]).toContain('/myAwardOp?');
  });

  it('직접 지정한 이름의 {Kind}도 치환한다', async () => {
    const f = fake(() => ok([]));
    const r = await probeOrg({ ...P, kind: 'Thng', noticeOp: 'getBid{Kind}X', awardOp: 'getAward{Kind}Y' }, f.ctx);
    expect(r.notice.op).toBe('getBidThngX');
    expect(r.award.op).toBe('getAwardThngY');
    expect(f.urls[0]).toContain('/getBidThngX?');
    expect(f.urls[0]).not.toContain('%7BKind');
  });
});
