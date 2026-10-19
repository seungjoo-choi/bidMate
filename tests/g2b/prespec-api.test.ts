import { describe, expect, it, vi } from 'vitest';
import { fetchPrespec, listPrespecAttachments, mapPrespecItem, PRESPEC_MAP, PRESPEC_OPERATIONS } from '../../src/adapters/g2b/prespec-api';
import { ALL_FIELD_KEYS } from '../../src/core/model/notice-fields';

// 추정: 실측(S0) 전. PRESPEC_MAP 키로 만든 합성 응답이다(실제 응답이 아님).
const col = (key: string) => PRESPEC_MAP.fields.find((f) => f.key === key)!.api;
const synthItem = (over: Record<string, string> = {}): Record<string, string> => ({
  [col('specRegNo')]: 'R26BD00273952',
  [col('specName')]: '통합 정보시스템 구축',
  [col('bizDivision')]: '용역',
  [col('assignedBudget')]: '1,234,000,000',
  [col('registeredAt')]: '2026-10-10 09:00:00',
  [col('opinionCloseAt')]: '2026-10-17 18:00:00',
  [col('officerName')]: '홍길동',
  [col('officerTel')]: '044-000-0000',
  [col('relatedBidNo')]: 'R26BK00000001',
  [col('orderingOrg')]: '발주기관',
  [col('demandOrg')]: '수요기관',
  [`${PRESPEC_MAP.attachUrl}1`]: 'https://www.g2b.go.kr/f/1',
  [`${PRESPEC_MAP.attachName}1`]: '규격서.hwp',
  [`${PRESPEC_MAP.attachUrl}2`]: 'https://www.g2b.go.kr/f/2',
  [`${PRESPEC_MAP.attachName}2`]: '과업내용서.pdf',
  ...over,
});
const body = (items: Record<string, string>[]) => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items } } });
const ctx = (f: unknown) => ({ serviceKey: 'KEY', fetch: f as typeof fetch });

describe('mapPrespecItem (추정 매핑)', () => {
  it('사전규격 필드와 basic 표시 필드를 채운다', () => {
    const m = mapPrespecItem(synthItem(), '2026-10-19T00:00:00Z');
    expect(m.specRegNo?.value).toBe('R26BD00273952');
    expect(m.specName?.value).toBe('통합 정보시스템 구축');
    expect(m.assignedBudget?.value).toBe(1234000000);
    expect(m.registeredAt?.value).toBeTruthy();
    expect(m.opinionCloseAt?.value).toBeTruthy();
    expect(m.relatedBidNo?.value).toBe('R26BK00000001');
    expect(m.noticeNo?.value).toBe('R26BD00273952');
    expect(m.title?.value).toBe('통합 정보시스템 구축');
    expect(m.postedAt?.value).toBe(m.registeredAt?.value);
    expect(m.budgetAmount).toMatchObject({ value: 1234000000, note: '배정예산' });
  });

  it('모든 필드 키가 존재하고 없는 값은 missing', () => {
    const m = mapPrespecItem({}, 't');
    for (const k of ALL_FIELD_KEYS) expect(m[k]).toBeDefined();
    expect(m.specName?.value).toBeNull();
    expect(m.budgetAmount?.value).toBeNull();
    expect(m.bidCloseAt?.value).toBeNull();
  });
});

describe('listPrespecAttachments', () => {
  it('URL과 이름 쌍을 순서대로 반환하고 빈 항목은 건너뛴다', () => {
    expect(listPrespecAttachments(synthItem())).toEqual([
      { originalName: '규격서.hwp', url: 'https://www.g2b.go.kr/f/1', expectedSize: null },
      { originalName: '과업내용서.pdf', url: 'https://www.g2b.go.kr/f/2', expectedSize: null },
    ]);
    expect(listPrespecAttachments({})).toEqual([]);
  });
});

describe('fetchPrespec', () => {
  it('첫 operation에서 찾으면 그 항목을 반환하고 번호 파라미터를 보낸다', async () => {
    const f = vi.fn(async (_url: string) => new Response(body([synthItem()])));
    const r = await fetchPrespec('R26BD00273952', ctx(f));
    expect(r).toMatchObject({ ok: true, operation: PRESPEC_OPERATIONS[0] });
    expect(f.mock.calls[0]![0]).toContain(`${PRESPEC_MAP.regNoParam}=R26BD00273952`);
  });

  it('같은 번호가 여러 건이면 접수일시 최신을 고른다', async () => {
    const f = vi.fn(async () => new Response(body([
      synthItem({ [col('specName')]: '구', [col('registeredAt')]: '2026-10-01 09:00:00' }),
      synthItem({ [col('specName')]: '신', [col('registeredAt')]: '2026-10-12 09:00:00' }),
    ])));
    const r = await fetchPrespec('R26BD00273952', ctx(f));
    expect(r.ok && r.item[col('specName')]).toBe('신');
  });

  it('모든 operation이 0건이면 G2B_NOT_FOUND', async () => {
    const f = vi.fn(async () => new Response(body([])));
    const r = await fetchPrespec('R26BD00273952', ctx(f));
    expect(f).toHaveBeenCalledTimes(PRESPEC_OPERATIONS.length);
    expect(r).toMatchObject({ ok: false, error: { code: 'G2B_NOT_FOUND' } });
    expect(!r.ok && r.error.message).toContain('사전규격을 찾지 못했습니다: R26BD00273952');
  });

  it('서비스키 오류는 G2B_KEY_INVALID, 키 미설정은 G2B_KEY_MISSING', async () => {
    const f = vi.fn(async () => new Response('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', { status: 401 }));
    expect(await fetchPrespec('R26BD00273952', ctx(f))).toMatchObject({ ok: false, error: { code: 'G2B_KEY_INVALID' } });
    expect(await fetchPrespec('R26BD00273952', { fetch: f as unknown as typeof fetch })).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
  });
});
