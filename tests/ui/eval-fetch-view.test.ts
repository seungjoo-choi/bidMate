import { describe, expect, it } from 'vitest';
import type { IndexEntry } from '../../src/core/types/index-file';
import { evalFetchable, openingOf, runEvalBatch, selectableForEval, type EvalBatchState } from '../../src/ui/notices/eval-fetch-view';

const NOW = new Date(2026, 9, 20, 12, 0);
const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
const entry = (p: Partial<IndexEntry>): IndexEntry => ({
  noticeId: 'R26BK00000001-000', noticeNo: 'R26BK00000001', round: '000', title: 't', orderingOrg: 'o', folder: 'f',
  collectedAt: at(1, 9), collectStatus: 'collected', attachments: { total: 0, saved: 0, failed: 0 },
  extractionStatus: 'verified', mailStatus: 'none', isCorrection: false, ...p,
});

describe('openingOf', () => {
  it('결과 추적 개찰일 → 일정 개찰일 → 입찰마감 순', () => {
    expect(openingOf(entry({ bidCloseAt: at(1, 9), schedule: { openingAt: at(2, 9) }, result: { status: 'waiting', openingAt: at(3, 9) } }))).toBe(at(3, 9));
    expect(openingOf(entry({ bidCloseAt: at(1, 9), schedule: { openingAt: at(2, 9) } }))).toBe(at(2, 9));
    expect(openingOf(entry({ bidCloseAt: at(1, 9) }))).toBe(at(1, 9));
    expect(openingOf(entry({}))).toBeUndefined();
  });
});

describe('evalFetchable', () => {
  it('개찰이 지난 입찰공고만 가능', () => {
    expect(evalFetchable(entry({ schedule: { openingAt: at(19, 10) } }), NOW).ok).toBe(true);
    expect(evalFetchable(entry({ schedule: { openingAt: at(21, 10) } }), NOW)).toEqual({ ok: false, reason: '개찰 전입니다' });
    expect(evalFetchable(entry({}), NOW)).toEqual({ ok: false, reason: '개찰 전입니다' });
    expect(evalFetchable(entry({ kind: 'prespec', bidCloseAt: at(1, 9) }), NOW).ok).toBe(false);
  });
});

describe('selectableForEval', () => {
  it('이미 가져온 공고는 고를 수 없다', () => {
    const e = entry({ bidCloseAt: at(1, 9) });
    expect(selectableForEval(e, NOW, new Set()).ok).toBe(true);
    expect(selectableForEval(e, NOW, new Set([e.noticeId]))).toEqual({ ok: false, reason: '이미 가져왔습니다' });
  });
});

describe('runEvalBatch', () => {
  const items = ['A', 'B', 'C'].map((x) => ({ noticeId: x, noticeNo: x, round: '000' }));
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const text = (code: string | undefined, m: string) => `${code}:${m}`;

  it('실패해도 다음으로 넘어가고 결과를 모은다', async () => {
    const seen: string[] = [];
    const updates: EvalBatchState[] = [];
    const r = await runEvalBatch(items, {
      collect: async (ref) => { seen.push(ref.noticeNo); if (ref.noticeNo === 'B') throw fail('EVAL_NO_RESULT'); },
      errorText: text, onUpdate: (s) => updates.push(s), cancelled: () => false,
    });
    expect(seen).toEqual(['A', 'B', 'C']);
    expect(r).toMatchObject({ running: false, total: 3, done: 3, ok: 2, failed: [{ noticeId: 'B', message: 'EVAL_NO_RESULT:EVAL_NO_RESULT' }] });
    expect(r.stopped).toBeUndefined();
    expect(r.current).toBeUndefined();
    expect(updates.some((u) => u.current === 'C' && u.running)).toBe(true);
  });

  it('로그인 오류면 남은 공고를 멈춘다', async () => {
    const seen: string[] = [];
    const r = await runEvalBatch(items, {
      collect: async (ref) => { seen.push(ref.noticeNo); if (ref.noticeNo === 'A') throw fail('EVAL_NOT_LOGGED_IN'); },
      errorText: text, onUpdate: () => undefined, cancelled: () => false,
    });
    expect(seen).toEqual(['A']);
    expect(r).toMatchObject({ done: 1, ok: 0, stopped: 'EVAL_NOT_LOGGED_IN:EVAL_NOT_LOGGED_IN' });
  });

  it('중단하면 지금 건까지만 하고 멈춘다', async () => {
    let stop = false;
    const seen: string[] = [];
    const r = await runEvalBatch(items, {
      collect: async (ref) => { seen.push(ref.noticeNo); stop = true; },
      errorText: text, onUpdate: () => undefined, cancelled: () => stop,
    });
    expect(seen).toEqual(['A']);
    expect(r).toMatchObject({ done: 1, ok: 1, stopped: '중단됨', running: false });
  });
});
