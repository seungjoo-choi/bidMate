import { describe, expect, it } from 'vitest';
import type { AiBatchState, AiReviewFile, AiRun } from '../../src/core/types/ai';
import { AiBatch, type AiBatchRunner } from '../../src/engine/ai/ai-batch';
import type { AiRunOutcome, ExecRequest } from '../../src/engine/ai/ai-runner';

const KEY = 'sk-batch-SECRET-5555';
const api = { key: KEY, model: 'm' };
const T0 = Date.parse('2026-10-20T00:00:00.000Z');

type Step = Partial<AiRunOutcome> & { throws?: { code: string; message: string }; hang?: boolean; /** exec가 돌아오기 전 지연(준비 중) */ delay?: number; /** 결과가 취소와 무관하게 이 시간 뒤에 done으로 나온다 */ delayDone?: number };
const ok = (over: Partial<AiRun> = {}): Step => ({
  status: 'done',
  run: { id: 'x', createdAt: '2026-10-20T00:00:01Z', provider: 'gemini', mode: 'api', model: 'm', promptVersion: '1', scope: 'pending', keys: [], extractionJobId: 'j', extractedAt: 't', status: 'done', files: [], skipped: [], excerptChars: 0, truncated: false, warnings: [], suggestions: {}, rejected: [], promptPath: 'p', ...over } as AiRun,
});
const fail = (code: string, message = 'm'): Step => ({ status: 'failed', error: { code, message } });

/** 공고별로 미리 정한 결과를 차례로 돌려주는 가짜 runner. 호출 순서·동시 실행·취소를 기록한다. */
function fakeRunner(script: Record<string, Step[]>) {
  const calls: Array<{ noticeId: string; scope: string; at: number; key: string }> = [];
  const cancels: string[] = [];
  let running = 0; let maxRunning = 0; let n = 0;
  const hangs = new Map<string, (o: AiRunOutcome) => void>();
  const runner: AiBatchRunner = {
    async exec(p: ExecRequest) {
      calls.push({ noticeId: p.noticeId, scope: p.scope, at: Date.now(), key: p.api.key });
      const step = (script[p.noticeId] ?? [ok()]).shift() ?? ok();
      if (step.delay) await new Promise((r) => setTimeout(r, step.delay));
      if (step.throws) throw Object.assign(new Error(step.throws.message), { code: step.throws.code });
      const runId = `run-${++n}`;
      running++; maxRunning = Math.max(maxRunning, running);
      const done = step.delayDone
        ? new Promise<AiRunOutcome>((res) => setTimeout(() => { running--; res(step as AiRunOutcome); }, step.delayDone))
        : step.hang
        ? new Promise<AiRunOutcome>((res) => { hangs.set(runId, (o) => { running--; res(o); }); })
        : Promise.resolve().then(() => { running--; return step as AiRunOutcome; });
      return { runId, done };
    },
    async cancel(p) { cancels.push(p.runId); hangs.get(p.runId)?.({ status: 'cancelled' }); return { cancelled: true }; },
  };
  return { runner, calls, cancels, maxRunning: () => maxRunning };
}

function make(script: Record<string, Step[]>, o: { gapMs?: number; rateWaitMs?: number; reviews?: Record<string, AiReviewFile | null> } = {}) {
  const fr = fakeRunner(script);
  const pushed: AiBatchState[] = [];
  let clock = T0;
  const batch = new AiBatch({
    runner: fr.runner, gapMs: o.gapMs ?? 1, rateWaitMs: o.rateWaitMs ?? 1,
    pushStatus: (s) => pushed.push(s),
    getReview: async (id) => o.reviews?.[id] ?? null,
    now: () => new Date(clock += 1000),
  });
  const start = (ids: string[], batchId = 'b1') => batch.start({ batchId, noticeIds: ids, provider: 'gemini', api });
  return { batch, pushed, start, ...fr };
}
const review = (status: AiRun['status'], createdAt: string): AiReviewFile => ({ schemaVersion: 1, noticeId: 'n', runs: [{ ...(ok().run as AiRun), status, createdAt }] });
const statuses = (b: AiBatchState) => b.items.map((i) => [i.noticeId, i.status, i.error?.code]);

describe('AiBatch', () => {
  it('공고를 순차로(동시 실행 없이) scope auto로 돌리고 사이에 간격을 둔다, 끝나면 done', async () => {
    const m = make({ a: [ok()], b: [ok()], c: [ok()] }, { gapMs: 40 });
    const { done } = m.start(['a', 'b', 'c']);
    await done;
    expect(m.calls.map((c) => [c.noticeId, c.scope])).toEqual([['a', 'auto'], ['b', 'auto'], ['c', 'auto']]);
    expect(m.maxRunning()).toBe(1);
    expect(m.calls[1]!.at - m.calls[0]!.at).toBeGreaterThanOrEqual(35);
    expect(m.calls[2]!.at - m.calls[1]!.at).toBeGreaterThanOrEqual(35);
    const last = m.batch.current()!;
    expect(last).toMatchObject({ status: 'done', batchId: 'b1', provider: 'gemini', model: 'm' });
    expect(last.finishedAt).toBeTruthy();
    expect(last.items.map((i) => [i.status, i.attempts])).toEqual([['done', 1], ['done', 1], ['done', 1]]);
    expect(last.items[0]!.summary).toEqual({ match: 0, proposals: 0, none: 0, rejected: 0 });
  });

  it('push는 상태 변화마다: 처음엔 전부 queued, 중간엔 running+currentIndex, 마지막은 done', async () => {
    const m = make({ a: [ok()], b: [ok()] });
    await m.start(['a', 'b']).done;
    expect(statuses(m.pushed[0]!)).toEqual([['a', 'queued', undefined], ['b', 'queued', undefined]]);
    expect(m.pushed.some((s) => s.status === 'running' && s.currentIndex === 1 && s.items[1]!.status === 'running')).toBe(true);
    expect(m.pushed.at(-1)!.status).toBe('done');
    expect(m.pushed.map((s) => s.updatedAt)).toEqual([...m.pushed.map((s) => s.updatedAt)].sort());
  });

  it('상태·push·오류 메시지에 키가 없다(오류 본문의 키도 가린다)', async () => {
    const m = make({ a: [fail('AI_TIMEOUT', `timeout while using ${KEY}`)], b: [{ throws: { code: 'AI_HTTP', message: `boom ${KEY}` } }], c: [ok()] });
    await m.start(['a', 'b', 'c']).done;
    expect(m.calls.every((c) => c.key === KEY)).toBe(true);
    expect(JSON.stringify(m.pushed)).not.toContain(KEY);
    expect(JSON.stringify(m.batch.current())).not.toContain(KEY);
  });

  it('QUOTA·AUTH는 즉시 중단: 항목 failed, 남은 항목 skipped AI_BATCH_STOPPED, stopReason', async () => {
    for (const code of ['AI_QUOTA', 'AI_AUTH']) {
      const m = make({ a: [ok()], b: [fail(code, '한도')], c: [ok()], d: [ok()] });
      await m.start(['a', 'b', 'c', 'd']).done;
      const s = m.batch.current()!;
      expect(s.status).toBe('stopped');
      expect(s.stopReason).toMatchObject({ code });
      expect(statuses(s)).toEqual([['a', 'done', undefined], ['b', 'failed', code], ['c', 'skipped', 'AI_BATCH_STOPPED'], ['d', 'skipped', 'AI_BATCH_STOPPED']]);
      expect(m.calls.map((c) => c.noticeId)).toEqual(['a', 'b']);
    }
  });

  it('RATE_LIMIT: waiting(waitUntil=가짜 시계+대기) 후 같은 공고를 1회 재시도해 성공하면 계속', async () => {
    const m = make({ a: [fail('AI_RATE_LIMIT'), ok()], b: [ok()] }, { rateWaitMs: 30 });
    await m.start(['a', 'b']).done;
    expect(m.calls.map((c) => c.noticeId)).toEqual(['a', 'a', 'b']);
    const waiting = m.pushed.find((s) => s.status === 'waiting')!;
    expect(waiting.items[0]).toMatchObject({ status: 'failed', attempts: 1, error: { code: 'AI_RATE_LIMIT' } });
    expect(Date.parse(waiting.waitUntil!) - Date.parse(waiting.updatedAt)).toBeLessThanOrEqual(30);
    expect(Date.parse(waiting.waitUntil!)).toBeGreaterThan(T0);
    const end = m.batch.current()!;
    expect(end.status).toBe('done');
    expect(end.items[0]).toMatchObject({ status: 'done', attempts: 2 });
    expect(end.items[0]!.error).toBeUndefined();
    expect(end.waitUntil).toBeUndefined();
  });

  it('RATE_LIMIT 재발 시 중단', async () => {
    const m = make({ a: [fail('AI_RATE_LIMIT'), fail('AI_RATE_LIMIT')], b: [ok()] });
    await m.start(['a', 'b']).done;
    const s = m.batch.current()!;
    expect(s.status).toBe('stopped');
    expect(s.stopReason!.code).toBe('AI_RATE_LIMIT');
    expect(statuses(s)).toEqual([['a', 'failed', 'AI_RATE_LIMIT'], ['b', 'skipped', 'AI_BATCH_STOPPED']]);
    expect(s.items[0]!.attempts).toBe(2);
  });

  it('OVERLOADED: 건 실패 기록 후 계속, 연속 3건이면 중단, 중간에 성공하면 연속이 끊긴다', async () => {
    const three = make({ a: [fail('AI_OVERLOADED')], b: [fail('AI_OVERLOADED')], c: [fail('AI_OVERLOADED')], d: [ok()] });
    await three.start(['a', 'b', 'c', 'd']).done;
    expect(three.batch.current()!.status).toBe('stopped');
    expect(three.batch.current()!.stopReason!.code).toBe('AI_OVERLOADED');
    expect(statuses(three.batch.current()!)).toEqual([['a', 'failed', 'AI_OVERLOADED'], ['b', 'failed', 'AI_OVERLOADED'], ['c', 'failed', 'AI_OVERLOADED'], ['d', 'skipped', 'AI_BATCH_STOPPED']]);

    const broken = make({ a: [fail('AI_OVERLOADED')], b: [fail('AI_OVERLOADED')], c: [ok()], d: [fail('AI_OVERLOADED')], e: [fail('AI_OVERLOADED')] });
    await broken.start(['a', 'b', 'c', 'd', 'e']).done;
    expect(broken.batch.current()!.status).toBe('done');
  });

  it('그 외 오류(exec 예외 NOT_FOUND·JOB_ALREADY_RUNNING·AI_RUN_BUSY·NO_DOCUMENTS, 결과 TIMEOUT·BAD_RESPONSE)는 기록하고 계속', async () => {
    const m = make({
      a: [{ throws: { code: 'NOT_FOUND', message: '없음' } }], b: [{ throws: { code: 'JOB_ALREADY_RUNNING', message: '추출 중' } }],
      c: [{ throws: { code: 'AI_RUN_BUSY', message: 'busy' } }], d: [{ throws: { code: 'NO_DOCUMENTS', message: '문서 없음' } }],
      e: [fail('AI_TIMEOUT')], f: [fail('AI_BAD_RESPONSE')], g: [ok()],
    });
    await m.start(['a', 'b', 'c', 'd', 'e', 'f', 'g']).done;
    const s = m.batch.current()!;
    expect(s.status).toBe('done');
    expect(statuses(s)).toEqual([
      ['a', 'skipped', 'NOT_FOUND'], ['b', 'skipped', 'JOB_ALREADY_RUNNING'], ['c', 'skipped', 'AI_RUN_BUSY'], ['d', 'skipped', 'NO_DOCUMENTS'],
      ['e', 'failed', 'AI_TIMEOUT'], ['f', 'failed', 'AI_BAD_RESPONSE'], ['g', 'done', undefined],
    ]);
  });

  it('사전 검사: 반자동 대기(awaiting)는 AI_RUN_BUSY, 배치 중 이미 실행된 공고는 AI_ALREADY_RAN, 그 전 run은 실행', async () => {
    const m = make({ a: [ok()], b: [ok()], c: [ok()], d: [ok()] }, {
      reviews: {
        a: review('awaiting', '2026-10-19T00:00:00Z'),
        b: review('done', '2026-10-20T23:00:00Z'),
        c: review('done', '2026-10-01T00:00:00Z'),
      },
    });
    await m.start(['a', 'b', 'c', 'd']).done;
    expect(m.calls.map((c) => c.noticeId)).toEqual(['c', 'd']);
    expect(statuses(m.batch.current()!)).toEqual([['a', 'skipped', 'AI_RUN_BUSY'], ['b', 'skipped', 'AI_ALREADY_RAN'], ['c', 'done', undefined], ['d', 'done', undefined]]);
    expect(m.batch.current()!.items[0]!.error!.message).toBe('AI 답변 붙여넣기 대기 중');
  });

  it('간격 대기 중 취소하면 즉시 깨어나 cancelled, 남은 항목은 AI_BATCH_CANCELLED', async () => {
    const m = make({ a: [ok()], b: [ok()], c: [ok()] }, { gapMs: 10_000 });
    const { done } = m.start(['a', 'b', 'c']);
    await new Promise((r) => setTimeout(r, 30)); // a가 끝나고 간격 대기에 들어간 뒤
    const t = Date.now();
    expect(await m.batch.cancel('b1')).toEqual({ cancelled: true });
    await done;
    expect(Date.now() - t).toBeLessThan(500);
    expect(m.calls.map((c) => c.noticeId)).toEqual(['a']);
    const s = m.batch.current()!;
    expect(s.status).toBe('cancelled');
    expect(statuses(s)).toEqual([['a', 'done', undefined], ['b', 'skipped', 'AI_BATCH_CANCELLED'], ['c', 'skipped', 'AI_BATCH_CANCELLED']]);
  });

  it('RATE_LIMIT 대기 중 취소도 즉시', async () => {
    const m = make({ a: [fail('AI_RATE_LIMIT'), ok()], b: [ok()] }, { rateWaitMs: 10_000 });
    const { done } = m.start(['a', 'b']);
    await new Promise((r) => setTimeout(r, 30));
    expect(m.batch.current()!.status).toBe('waiting');
    const t = Date.now();
    await m.batch.cancel('b1');
    await done;
    expect(Date.now() - t).toBeLessThan(500);
    expect(m.calls).toHaveLength(1);
    expect(statuses(m.batch.current()!)).toEqual([['a', 'skipped', 'AI_BATCH_CANCELLED'], ['b', 'skipped', 'AI_BATCH_CANCELLED']]);
    expect(m.batch.current()!.status).toBe('cancelled');
  });

  it('실행 중 취소는 현재 공고의 runner.cancel도 부른다', async () => {
    const m = make({ a: [{ hang: true }], b: [ok()] });
    const { done } = m.start(['a', 'b']);
    await new Promise((r) => setTimeout(r, 20));
    await m.batch.cancel('b1');
    await done;
    expect(m.cancels).toEqual(['run-1']);
    expect(m.calls.map((c) => c.noticeId)).toEqual(['a']);
    expect(statuses(m.batch.current()!)).toEqual([['a', 'skipped', 'AI_BATCH_CANCELLED'], ['b', 'skipped', 'AI_BATCH_CANCELLED']]);
  });

  it('준비 중(exec 반환 전)에 취소해도 반환 뒤 그 run을 취소하고 cancelled로 끝난다', async () => {
    const m = make({ a: [{ hang: true, delay: 40 }], b: [ok()] });
    const { done } = m.start(['a', 'b']);
    await new Promise((r) => setTimeout(r, 10));
    expect(await m.batch.cancel('b1')).toEqual({ cancelled: true });
    await done;
    expect(m.cancels).toEqual(['run-1']);
    expect(m.calls.map((c) => c.noticeId)).toEqual(['a']);
    expect(m.batch.current()!.status).toBe('cancelled');
    expect(statuses(m.batch.current()!)).toEqual([['a', 'skipped', 'AI_BATCH_CANCELLED'], ['b', 'skipped', 'AI_BATCH_CANCELLED']]);
  });

  it('마지막 공고를 실행하는 중에 취소하면(결과는 done) 배치는 done이 아니라 cancelled', async () => {
    const m = make({ a: [{ ...ok(), delayDone: 40 }] });
    const { done } = m.start(['a']);
    await new Promise((r) => setTimeout(r, 10));
    await m.batch.cancel('b1');
    await done;
    const s = m.batch.current()!;
    expect(s.status).toBe('cancelled');
    expect(s.items[0]).toMatchObject({ status: 'done' });
    expect(s.finishedAt).toBeTruthy();
    expect(m.pushed.at(-1)!.status).toBe('cancelled');
  });

  it('건너뜀은 연속 과부하 카운터를 리셋하지 않는다(실행한 건만 센다)', async () => {
    const m = make({ a: [fail('AI_OVERLOADED')], c: [fail('AI_OVERLOADED')], d: [fail('AI_OVERLOADED')], e: [ok()] }, {
      reviews: { b: review('awaiting', '2026-10-19T00:00:00Z') },
    });
    await m.start(['a', 'b', 'c', 'd', 'e']).done;
    expect(m.batch.current()!.status).toBe('stopped');
    expect(m.batch.current()!.stopReason!.code).toBe('AI_OVERLOADED');
  });

  it('활성 배치가 있으면 AI_BATCH_BUSY, 끝나면 새로 시작 가능, 다른 batchId·없는 배치 취소는 false', async () => {
    const m = make({ a: [{ hang: true }] });
    const first = m.start(['a']);
    expect(() => m.start(['x'], 'b2')).toThrowError(expect.objectContaining({ code: 'AI_BATCH_BUSY' }));
    expect(await m.batch.cancel('other')).toEqual({ cancelled: false });
    await new Promise((r) => setTimeout(r, 10));
    await m.batch.cancel('b1');
    await first.done;
    expect(await m.batch.cancel('b1')).toEqual({ cancelled: false });
    await expect(m.start(['z'], 'b3').done).resolves.toBeUndefined();
    expect(m.batch.current()!.batchId).toBe('b3');
  });

  it('current()는 복사본이다', async () => {
    const m = make({ a: [ok()] });
    await m.start(['a']).done;
    const s = m.batch.current()!;
    s.items[0]!.status = 'failed';
    expect(m.batch.current()!.items[0]!.status).toBe('done');
  });
});
