import { describe, expect, it } from 'vitest';
import {
  G2B_FAILURES_MAX, SKIP_CODES, appendFailures, failuresFromJob, formatFailures, normalizeFailure,
  type G2bFailure, type G2bFailureInput,
} from '../../src/core/diagnostics/g2b-failure';
import type { Job } from '../../src/core/types/job';

const id = (s: string) => s;
const base: G2bFailureInput = { flow: 'eval', stage: 'fetch', code: 'EVAL_API_ERROR', message: 'm' };
const NOW = new Date('2026-10-22T00:00:00.000Z');

describe('normalizeFailure', () => {
  it('flow 밖·필수 누락·비객체는 null', () => {
    expect(normalizeFailure(null, id)).toBeNull();
    expect(normalizeFailure('x', id)).toBeNull();
    expect(normalizeFailure({ ...base, flow: 'nope' }, id)).toBeNull();
    expect(normalizeFailure({ ...base, code: undefined }, id)).toBeNull();
    expect(normalizeFailure({ ...base, stage: 1 }, id)).toBeNull();
    expect(normalizeFailure({ ...base, message: undefined }, id)).toBeNull();
  });
  it.each([...SKIP_CODES])('SKIP_CODES %s는 null', (code) => {
    expect(normalizeFailure({ ...base, code }, id)).toBeNull();
  });
  it('길이를 자른다', () => {
    const r = normalizeFailure({ ...base, message: 'a'.repeat(400), g2bMsg: 'b'.repeat(300), endpoint: 'c'.repeat(200) }, id)!;
    expect(r.message).toHaveLength(300);
    expect(r.g2bMsg).toHaveLength(200);
    expect(r.endpoint).toHaveLength(120);
  });
  it('범위 밖 숫자는 키를 제거한다', () => {
    for (const step of [0, 10, 1.5]) expect('step' in normalizeFailure({ ...base, step }, id)!).toBe(false);
    for (const httpStatus of [99, 600]) expect('httpStatus' in normalizeFailure({ ...base, httpStatus }, id)!).toBe(false);
    const ok = normalizeFailure({ ...base, step: 3, httpStatus: 422, ms: 0 }, id)!;
    expect(ok).toMatchObject({ step: 3, httpStatus: 422, ms: 0 });
    expect('ms' in normalizeFailure({ ...base, ms: -1 }, id)!).toBe(false);
  });
  it('알 수 없는 키는 제거한다', () => {
    const r = normalizeFailure({ ...base, secret: 'x', id: 'y', count: 5 }, id)!;
    expect(Object.keys(r).sort()).toEqual(['code', 'flow', 'message', 'stage']);
  });
  it('message·g2bMsg·endpoint에 redact를 적용한다', () => {
    const r = normalizeFailure({ ...base, message: 'KEY m', g2bMsg: 'KEY g', endpoint: '/e?k=KEY' }, (s) => s.replaceAll('KEY', '***'))!;
    expect(r.message).toBe('*** m');
    expect(r.g2bMsg).toBe('*** g');
    expect(r.endpoint).toBe('/e?k=***');
  });
  it('tab 값을 검증한다', () => {
    expect(normalizeFailure({ ...base, tab: 'reused' }, id)!.tab).toBe('reused');
    expect('tab' in normalizeFailure({ ...base, tab: 'weird' }, id)!).toBe(false);
  });
});

describe('appendFailures', () => {
  let n = 0;
  const newId = () => `id${++n}`;
  it('빈 파일 1건은 count 1, at=lastAt', () => {
    const f = appendFailures(undefined, [base], NOW, newId);
    expect(f.v).toBe(1);
    expect(f.items).toHaveLength(1);
    expect(f.items[0]).toMatchObject({ count: 1, at: NOW.toISOString(), lastAt: NOW.toISOString() });
  });
  it('동일 키 연속은 count 2, lastAt 갱신, at 유지', () => {
    const t1 = new Date(NOW.getTime() + 1000);
    const f1 = appendFailures(undefined, [base], NOW, newId);
    const f2 = appendFailures(f1, [base], t1, newId);
    expect(f2.items).toHaveLength(1);
    expect(f2.items[0]).toMatchObject({ count: 2, at: NOW.toISOString(), lastAt: t1.toISOString() });
  });
  it('공고번호만 다르면 2건', () => {
    const f = appendFailures(undefined, [{ ...base, noticeNo: 'A' }, { ...base, noticeNo: 'B' }], NOW, newId);
    expect(f.items).toHaveLength(2);
  });
  it('나중 입력이 items[0]', () => {
    const f = appendFailures(undefined, [{ ...base, noticeNo: 'A' }, { ...base, noticeNo: 'B' }], NOW, newId);
    expect(f.items[0]!.noticeNo).toBe('B');
  });
  it('v 다름·items 비배열은 초기화', () => {
    const bad1 = { v: 2, items: [{ ...base, id: 'x', at: 't', lastAt: NOW.toISOString(), count: 1 }] } as never;
    expect(appendFailures(bad1, [], NOW, newId).items).toEqual([]);
    const bad2 = { v: 1, items: 'x' } as never;
    expect(appendFailures(bad2, [base], NOW, newId).items).toHaveLength(1);
  });
  it('301건째는 가장 오래된 것이 탈락', () => {
    const inputs = Array.from({ length: G2B_FAILURES_MAX + 1 }, (_, i) => ({ ...base, noticeNo: `N${i}` }));
    const f = appendFailures(undefined, inputs, NOW, newId);
    expect(f.items).toHaveLength(G2B_FAILURES_MAX);
    expect(f.items[0]!.noticeNo).toBe(`N${G2B_FAILURES_MAX}`);
    expect(f.items.some((x) => x.noticeNo === 'N0')).toBe(false);
  });
  it('31일 지난 항목은 제거', () => {
    const old: G2bFailure = { ...base, id: 'o', at: '2026-09-01T00:00:00.000Z', lastAt: '2026-09-01T00:00:00.000Z', count: 1 };
    const f = appendFailures({ v: 1, items: [old] }, [{ ...base, noticeNo: 'Z' }], NOW, newId);
    expect(f.items.map((x) => x.id)).not.toContain('o');
    expect(f.items).toHaveLength(1);
  });
});

describe('failuresFromJob', () => {
  const job = (o: Partial<Job>): Job => ({
    id: 'j1', type: 'collect', noticeId: 'n-1', ref: { noticeNo: '20260001', round: '00', origin: 'g2b' }, status: 'failed',
    steps: [], attempt: 1, createdAt: 't', updatedAt: 't', errors: [], ...o,
  });
  it('completed는 []', () => {
    expect(failuresFromJob(job({ status: 'completed' }))).toEqual([]);
  });
  it('failed + fetch_basic + G2B_NOT_FOUND → collect/fetch_basic', () => {
    const r = failuresFromJob(job({ errors: [{ code: 'G2B_NOT_FOUND', message: 'nf', step: 'fetch_basic', retryable: false }] }));
    expect(r).toEqual([{ flow: 'collect', stage: 'fetch_basic', code: 'G2B_NOT_FOUND', message: 'nf', noticeNo: '20260001', round: '00', noticeId: 'n-1', jobId: 'j1' }]);
  });
  it('partial + PRESPEC_FETCH_FAILED → collect/prespec', () => {
    const r = failuresFromJob(job({ status: 'partial', errors: [{ code: 'PRESPEC_FETCH_FAILED', message: 'p', step: 'fetch_basic', retryable: true }] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ flow: 'collect', stage: 'prespec' });
  });
  it('fetch_html DETAIL_TIMEOUT은 []', () => {
    expect(failuresFromJob(job({ errors: [{ code: 'DETAIL_TIMEOUT', message: 't', step: 'fetch_html', retryable: true }] }))).toEqual([]);
  });
  const atts = [
    { name: 'a.hwp', savedName: null, status: 'failed' as const, size: null, error: 'HTTP 500' },
    { name: 'b.pdf', savedName: null, status: 'size_mismatch' as const, size: 1 },
    { name: 'c.pdf', savedName: 'c.pdf', status: 'saved' as const, size: 1 },
  ];
  it('첨부 2건 실패 → attachment 1건(두 파일명)', () => {
    const r = failuresFromJob(job({ status: 'partial', result: { noticeId: 'n-1', folder: 'f', attachments: atts } }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ flow: 'attachment', stage: 'download', code: 'ATTACH_FAILED' });
    expect(r[0]!.message).toContain('2건 실패');
    expect(r[0]!.message).toContain('a.hwp');
    expect(r[0]!.message).toContain('b.pdf');
  });
  it('compose 잡은 []', () => {
    expect(failuresFromJob(job({ type: 'compose', errors: [{ code: 'G2B_X', message: 'x', step: 'fetch_basic', retryable: false }] }))).toEqual([]);
  });
  it('download_retry 첨부 실패 → attachment', () => {
    const r = failuresFromJob(job({ type: 'download_retry', status: 'partial', result: { noticeId: 'n-1', folder: 'f', attachments: atts } }));
    expect(r).toHaveLength(1);
    expect(r[0]!.flow).toBe('attachment');
  });
});

describe('formatFailures', () => {
  const f = (o: Partial<G2bFailure>): G2bFailure => ({ ...base, id: 'i', at: NOW.toISOString(), lastAt: NOW.toISOString(), count: 1, ...o });
  it('없는 필드는 칸을 생략하고 count>1이면 ×count', () => {
    const [a, b] = formatFailures([f({}), f({ noticeNo: '1', round: '00', step: 2, httpStatus: 422, tab: 'own', g2bMsg: 'g', endpoint: '/e', count: 3 })]).split('\n');
    expect(a).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \| eval\/fetch \| EVAL_API_ERROR \| m$/);
    expect(b).toMatch(/\| eval\/fetch \| 1-00 \| EVAL_API_ERROR \| 단계2 \| HTTP 422 \| 요청한 탭 \| m \| g2b: g \| \/e \| ×3$/);
  });
});
