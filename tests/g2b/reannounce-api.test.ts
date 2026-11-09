import { describe, expect, it } from 'vitest';
import type { ApiItem } from '../../src/adapters/g2b/openapi';
import { formatKstCompact, isStopError, matchReannounce, searchReannounce } from '../../src/adapters/g2b/reannounce-api';

const ok = (items: unknown[]) => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: items.length === 1 ? { item: items[0] } : { item: items }, totalCount: items.length } } });
const P = { prevNoticeNo: 'R26BK01289373', prevTitle: 'A 용역', orgCode: 'B553501', opKinds: ['Servc', 'Thng', 'Cnstwk', 'Frgcpt'] as const, fromMs: Date.parse('2026-02-01T00:00:00Z'), toMs: Date.parse('2026-02-28T14:59:00Z') };

function fake(bodyOf: (url: string) => string) {
  const urls: string[] = [];
  const fetch = (async (url: string) => { urls.push(url); return new Response(bodyOf(url)); }) as unknown as typeof globalThis.fetch;
  return { urls, ctx: { serviceKey: 'KEY', fetch } };
}

describe('matchReannounce', () => {
  it('befBidBbancNo 일치가 제목 일치보다 우선한다', () => {
    const items: ApiItem[] = [
      { bidNtceNo: 'T1', bidNtceOrd: '000', reNtceYn: 'Y', bidNtceNm: 'A 용역(재공고)', bidNtceDt: '2026-02-10 09:00:00' },
      { bidNtceNo: 'P1', bidNtceOrd: '001', befBidBbancNo: ' R26BK01289373 ', reNtceYn: 'Y', bidNtceNm: '전혀 다른 제목', bidNtceDt: '2026-02-05 09:00:00' },
    ];
    expect(matchReannounce(items, 'R26BK01289373', 'A 용역')).toMatchObject({ noticeNo: 'P1', round: '001', matchedBy: 'prevNo' });
  });

  it('자기 자신은 제외한다', () => {
    const items = [{ bidNtceNo: 'R26BK01289373', befBidBbancNo: 'R26BK01289373', reNtceYn: 'Y', bidNtceNm: 'A 용역' }];
    expect(matchReannounce(items, 'R26BK01289373', 'A 용역')).toBeNull();
  });

  it('제목 정규화로 매칭하고 차수가 없으면 000', () => {
    const items = [{ bidNtceNo: 'T1', reNtceYn: 'Y', bidNtceNm: '[긴급] A 용역 (재공고)', bidNtceDt: '2026-02-10 09:00:00' }];
    const h = matchReannounce(items, 'X', 'A 용역');
    expect(h).toMatchObject({ noticeNo: 'T1', round: '000', matchedBy: 'title', postedAt: '2026-02-10T09:00:00+09:00' });
  });

  it('reNtceYn이 Y가 아니면 제목이 같아도 매칭하지 않는다', () => {
    expect(matchReannounce([{ bidNtceNo: 'T1', reNtceYn: 'N', bidNtceNm: 'A 용역' }], 'X', 'A 용역')).toBeNull();
  });

  it('여러 건이면 bidNtceDt 최신', () => {
    const items: ApiItem[] = [
      { bidNtceNo: 'O', befBidBbancNo: 'X', bidNtceDt: '2026-02-05 09:00:00' },
      { bidNtceNo: 'N', befBidBbancNo: 'X', bidNtceDt: '2026-02-20 09:00:00' },
      { bidNtceNo: 'M', befBidBbancNo: 'X', bidNtceDt: '2026-02-10 09:00:00' },
    ];
    expect(matchReannounce(items, 'X', 't')?.noticeNo).toBe('N');
  });

  it('없으면 null', () => {
    expect(matchReannounce([{ bidNtceNo: 'Z', bidNtceNm: '다른 공고' }], 'X', 'A 용역')).toBeNull();
    expect(matchReannounce([], 'X', 'A 용역')).toBeNull();
  });
});

describe('searchReannounce', () => {
  it('hit가 나오면 op 순회를 멈추고 그 kind를 돌려준다', async () => {
    const f = fake((u) => (u.includes('Thng') ? ok([{ bidNtceNo: 'N1', bidNtceOrd: '000', befBidBbancNo: P.prevNoticeNo, bidNtceNm: 'A 용역' }]) : ok([{ bidNtceNo: 'Q' }])));
    const r = await searchReannounce(P, f.ctx);
    expect(r).toMatchObject({ ok: true, opKind: 'Thng', calls: 2, hit: { noticeNo: 'N1', matchedBy: 'prevNo' } });
    expect(f.urls).toHaveLength(2);
    expect(f.urls[0]).toContain('getBidPblancListInfoServcPPSSrch');
    expect(f.urls[1]).toContain('getBidPblancListInfoThngPPSSrch');
  });

  it('오류는 즉시 반환하고 calls를 센다', async () => {
    const f = fake(() => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' } } }));
    const r = await searchReannounce(P, f.ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.calls).toBe(1);
      expect(JSON.stringify(r.error)).not.toContain('KEY');
    }
    expect(f.urls).toHaveLength(1);
  });

  it('모두 없으면 hit null, opKind null, calls 4', async () => {
    const f = fake(() => ok([{ bidNtceNo: 'Q', bidNtceNm: '무관' }]));
    const r = await searchReannounce(P, f.ctx);
    expect(r).toMatchObject({ ok: true, hit: null, opKind: null, calls: 4 });
  });

  it('URL에 inqryDiv, dminsttCd, YYYYMMDDHHMM 기간이 들어간다', async () => {
    const f = fake(() => ok([{ bidNtceNo: 'Q' }]));
    await searchReannounce({ ...P, opKinds: ['Servc'] }, f.ctx);
    expect(f.urls[0]).toContain('inqryDiv=1');
    expect(f.urls[0]).toContain('dminsttCd=B553501');
    expect(f.urls[0]).toContain('inqryBgnDt=202602010900');
    expect(f.urls[0]).toContain('inqryEndDt=202602282359');
  });

  it('키가 없으면 G2B_KEY_MISSING, 호출 0회', async () => {
    const f = fake(() => ok([{ a: '1' }]));
    const r = await searchReannounce(P, { fetch: f.ctx.fetch });
    expect(r).toMatchObject({ ok: false, calls: 0, error: { code: 'G2B_KEY_MISSING' } });
    expect(f.urls).toHaveLength(0);
  });
});

describe('formatKstCompact', () => {
  it('UTC 2026-02-01T00:00Z는 202602010900', () => {
    expect(formatKstCompact(Date.parse('2026-02-01T00:00:00Z'))).toBe('202602010900');
  });
});

describe('isStopError', () => {
  it('중단 코드 배열이 비어 있으면 false', () => {
    expect(isStopError({ code: 'G2B_RATE_LIMIT', message: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', step: 'fetch_basic', retryable: true })).toBe(false);
  });
});
