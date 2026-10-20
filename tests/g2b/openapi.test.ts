import { describe, expect, it, vi } from 'vitest';
import servcFx from '../fixtures/g2b-servc-R26BK01722175.json';
import nokeyFx from '../fixtures/g2b-error-nokey.json';
import emptyFx from '../fixtures/g2b-thng-empty.json';
import { fetchNotice, listAttachments, mapApiItem, redactKey, resolveRef, type ApiItem } from '../../src/adapters/g2b/openapi';

const servc = JSON.stringify(servcFx);
const item = servcFx.response.body.items[0] as unknown as ApiItem;
const at = '2026-10-17T00:00:00.000Z';

const resp = (body: string, status = 200) => new Response(body, { status });

describe('mapApiItem', () => {
  const f = mapApiItem(item, at);
  it('주요 필드 매핑', () => {
    expect(f.title?.value).toBe('필리핀 카라바오 낙농개량체계(NDHI) 구축 및 농가역량강화사업 시스템 개발 PC 용역');
    expect(f.bidCloseAt?.value).toBe('2026-10-22T14:00:00+09:00');
    expect(f.registrationDeadline?.value).toBe('2026-10-21T18:00:00+09:00');
    expect(f.budgetAmount?.value).toBe(1923000000);
    expect(f.budgetAmount?.source?.kind).toBe('derived');
    expect(f.estimatedPrice?.value).toBe(1748181818);
    expect(f.jointVentureAllowed?.value).toBe(true);
    expect(f.jointVentureAllowed?.raw).toBe('(전자)공동이행');
    expect(String(f.evalMethod?.value)).toContain('기술 90 : 가격 10');
    expect(f.priceMethod?.value).toBe('비예가');
    expect(f.projectPeriod?.status).toBe('missing');
  });
  it('bfSpecRgstNo를 specRegNo로 매핑하고 다른 필드는 덮어쓰지 않는다', () => {
    const g = mapApiItem({ ...item, bfSpecRgstNo: 'R26BD00246532' }, at);
    expect(g.specRegNo?.value).toBe('R26BD00246532');
    expect(g.title?.value).toBe(f.title?.value);
    expect(mapApiItem({ ...item, bfSpecRgstNo: '' }, at).specRegNo?.value).toBeNull();
  });
  it('VAT가 없으면 배정예산', () => {
    const g = mapApiItem({ ...item, VAT: '' }, at);
    expect(g.budgetAmount?.value).toBe(1923000000);
    expect(g.budgetAmount?.note).toBe('배정예산');
  });
});

describe('listAttachments', () => {
  it('7개, 첫 항목 이름', () => {
    const list = listAttachments(item);
    expect(list).toHaveLength(7);
    expect(list[0]?.originalName).toBe('1. 입찰공고문.hwp');
  });
});

describe('fetchNotice', () => {
  const empty = JSON.stringify(emptyFx);
  it('유형 순차 시도: Servc 0건 → Thng 사용', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return resp(url.includes('Servc') ? empty : servc);
    });
    const r = await fetchNotice('R26BK01722175', undefined, { serviceKey: 'KEY==', fetch: fetchMock as never });
    expect(r.ok && r.operation).toBe('getBidPblancListInfoThng');
    expect(calls[0]).toContain('serviceKey=KEY%3D%3D');
  });
  it('모두 0건이면 NOT_FOUND', async () => {
    const r = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: (async () => resp(empty)) as never });
    expect(!r.ok && r.error.code).toBe('G2B_NOT_FOUND');
  });
  it('키 없음 → G2B_KEY_MISSING', async () => {
    const r = await fetchNotice('X', undefined, { fetch: (async () => resp(empty)) as never });
    expect(!r.ok && r.error.code).toBe('G2B_KEY_MISSING');
  });
  it('오류 분류', async () => {
    const k = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: (async () => resp(JSON.stringify(nokeyFx))) as never });
    expect(!k.ok && k.error.code).toBe('G2B_KEY_INVALID');
    const body = JSON.stringify({ 'nkoneps.com.response.ResponseError': { header: { resultCode: '07', resultMsg: '입력범위값 초과 에러' } } });
    const a = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: (async () => resp(body)) as never });
    expect(!a.ok && a.error.code).toBe('G2B_API_ERROR');
  });
  it('네트워크 오류는 retryable', async () => {
    const r = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: (async () => { throw new Error('fail https://x?serviceKey=SECRET123&a=1'); }) as never });
    expect(!r.ok && r.error.code).toBe('G2B_NETWORK');
    expect(!r.ok && r.error.retryable).toBe(true);
    expect(!r.ok && r.error.message).not.toContain('SECRET123');
  });
  it('round 지정 시 일치 항목, 미지정 시 최대 차수', async () => {
    const mk = (ord: string) => ({ ...item, bidNtceOrd: ord });
    const body = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [mk('000'), mk('002'), mk('001')] } } });
    const f = (async () => resp(body)) as never;
    const a = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: f });
    expect(a.ok && a.item.bidNtceOrd).toBe('002');
    const b = await fetchNotice('X', '001', { serviceKey: 'K', fetch: f });
    expect(b.ok && b.item.bidNtceOrd).toBe('001');
  });
});

describe('redactKey', () => {
  it('serviceKey 파라미터와 키 원문을 가린다', () => {
    expect(redactKey('GET https://a?serviceKey=abc%3D&x=1', undefined)).toBe('GET https://a?serviceKey=***&x=1');
    expect(redactKey('key is TOPSECRET ok', 'TOPSECRET')).toBe('key is *** ok');
  });
});

describe('resolveRef', () => {
  it('링크 URL', () => {
    expect(resolveRef('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000')).toMatchObject({ noticeNo: 'R26BK01722175', round: '000', origin: 'g2b' });
  });
  it('번호-차수 / 번호만 / 잘못된 값', () => {
    expect(resolveRef('https://evil.example/link/x/?bidPbancNo=R26BK01722175&bidPbancOrd=000')).toBeNull();
    expect(resolveRef('R26BK01722175-000')).toMatchObject({ noticeNo: 'R26BK01722175', round: '000' });
    // 나라장터 화면 실측 표기(하이픈 앞뒤 공백)
    expect(resolveRef('R26BK01722175 - 000')).toMatchObject({ noticeNo: 'R26BK01722175', round: '000' });
    const bare = resolveRef('R26BK01722175');
    expect(bare?.noticeNo).toBe('R26BK01722175');
    expect(bare?.round).toBeUndefined();
    expect(resolveRef('hello')).toBeNull();
  });

  describe('abort', () => {
    const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    it('외부 abort → JOB_CANCELLED(retryable false)', async () => {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 10);
      const r = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: hang as never, signal: ac.signal });
      expect(!r.ok && r.error.code).toBe('JOB_CANCELLED');
      expect(!r.ok && r.error.retryable).toBe(false);
    });
    it('시작 전에 이미 abort면 fetch하지 않는다', async () => {
      const ac = new AbortController();
      ac.abort();
      const f = vi.fn(hang);
      const r = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: f as never, signal: ac.signal });
      expect(!r.ok && r.error.code).toBe('JOB_CANCELLED');
      expect(f).not.toHaveBeenCalled();
    });
    it('타이머 abort → G2B_NETWORK', async () => {
      const r = await fetchNotice('X', undefined, { serviceKey: 'K', fetch: hang as never, timeoutMs: 10 });
      expect(!r.ok && r.error.code).toBe('G2B_NETWORK');
    });
  });
});
