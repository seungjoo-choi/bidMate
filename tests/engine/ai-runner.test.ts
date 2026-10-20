import { describe, expect, it } from 'vitest';
import { loadRules } from '../../src/core/extraction/rules/load';
import type { AiReviewFile, AiRunState } from '../../src/core/types/ai';
import type { Notice } from '../../src/core/types/notice';
import { AiRunner } from '../../src/engine/ai/ai-runner';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { docOf, fakeParsers, readJsonFile, runCollect } from '../helpers/extract-harness';
import { MemoryStore } from '../helpers/memory-store';

const KEY = 'sk-ant-RUNNER-SECRET-77';
const Q = '신용평가 배점 10점 (신용평가 항목 기준표)';
const LINES = ['평가항목 안내입니다 정량평가 기준표', Q, '수행실적 인정기간은 공고일 기준 최근 5년간으로 한다'];
const resp = (runId: string) => JSON.stringify({
  schema: 'bidmate-ai-review/1', runId, items: [{ key: 'credibilityScore', value: 10, quote: Q, file: '1. 입찰공고문.hwp', page: null }],
});
const claudeOk = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200 });

/** ai-review.json 쓰기를 실패시킬 수 있는 저장소 */
class FlakyStore extends MemoryStore {
  failReviewWrites = false;
  override async writeText(path: string, text: string) {
    if (this.failReviewWrites && path.endsWith('/ai-review.json')) throw Object.assign(new Error('disk'), { code: 'DISK_FULL' });
    return super.writeText(path, text);
  }
}

async function setup() {
  const store = new FlakyStore();
  await runCollect({ files: { '1. 입찰공고문.hwp': 'x' }, parsers: fakeParsers(async () => docOf(...LINES)), store });
  const noticeId = readJsonFile<Notice>(store, '/notice.json').id;
  const pushed: AiRunState[] = [];
  let n = 0;
  const make = (fetchFn: typeof fetch) => new AiRunner({
    store, fetch: fetchFn, pushStatus: (s) => pushed.push(s), retryDelayMs: 1,
    apiDeps: async () => ({ rules: loadRules(), newId: () => `run-${++n}` }),
  });
  const review = async (): Promise<AiReviewFile> => {
    const notice = (await new NoticeStore(store).loadNotice(noticeId))!;
    return JSON.parse(await store.readText(`${notice.folder}/ai-review.json`)) as AiReviewFile;
  };
  return { store, noticeId, pushed, make, review };
}
const req = (noticeId: string) => ({ noticeId, scope: 'all' as const, provider: 'claude' as const, api: { key: KEY, model: 'm' } });
const gate = () => { let release!: () => void; const p = new Promise<void>((r) => { release = r; }); return { p, release }; };

describe('AiRunner', () => {
  it('상태 push 순서: preparing → requesting → verifying → done, 끝나면 Map이 비워진다', async () => {
    const { noticeId, pushed, make, review } = await setup();
    const runner = make((async () => claudeOk(resp('run-1'))) as unknown as typeof fetch);
    const { runId, done } = await runner.exec(req(noticeId));
    expect(runId).toBe('run-1');
    expect(runner.isRunning(noticeId)).toBe(true);
    await done;
    expect(pushed.map((s) => s.status)).toEqual(['preparing', 'requesting', 'verifying', 'done']);
    expect(pushed.every((s) => s.noticeId === noticeId && s.runId === 'run-1' && s.provider === 'claude')).toBe(true);
    expect(runner.isRunning(noticeId)).toBe(false);
    expect((await review()).runs[0]!.status).toBe('done');
    expect(JSON.stringify(pushed)).not.toContain(KEY);
  });

  it('공고당 1개: 실행 중이면 exec·prepare 모두 AI_RUN_BUSY, 끝나면 다시 가능', async () => {
    const { noticeId, make } = await setup();
    const g = gate();
    const runner = make((async () => { await g.p; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    const first = await runner.exec(req(noticeId));
    await expect(runner.exec(req(noticeId))).rejects.toMatchObject({ code: 'AI_RUN_BUSY' });
    await expect(runner.prepare({ noticeId, scope: 'all', provider: 'claude' })).rejects.toMatchObject({ code: 'AI_RUN_BUSY' });
    g.release();
    await first.done;
    const prepared = await runner.prepare({ noticeId, scope: 'all', provider: 'claude' });
    expect(prepared.run.status).toBe('awaiting');
  });

  it('prepare 실패(대상 없음 등)는 Map을 비운다', async () => {
    const { make } = await setup();
    const runner = make((async () => claudeOk('')) as unknown as typeof fetch);
    await expect(runner.exec(req('없는공고'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(runner.isRunning('없는공고')).toBe(false);
  });

  it('cancel은 진행 중 fetch를 abort하고 cancelled를 push한다', async () => {
    const { noticeId, pushed, make, review } = await setup();
    let signal: AbortSignal | undefined;
    const runner = make(((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch);
    const { runId, done } = await runner.exec(req(noticeId));
    await new Promise((r) => setTimeout(r, 20));
    expect(await runner.cancel({ noticeId, runId })).toEqual({ cancelled: true });
    await done;
    expect(signal!.aborted).toBe(true);
    expect(pushed.at(-1)!.status).toBe('cancelled');
    expect((await review()).runs[0]!.status).toBe('cancelled');
    expect(runner.isRunning(noticeId)).toBe(false);
  });

  it('예외 시 failRun + failed push, failRun 자체가 던져도 failed push는 나가고 키는 가려진다', async () => {
    const { store, noticeId, pushed, make, review } = await setup();
    // 응답 txt 쓰기가 실패하면 finishRun이 파싱 실패가 아닌 오류를 던진다 → 러너가 failRun으로 닫는다.
    const origWrite = store.writeText.bind(store);
    store.writeText = async (path: string, text: string) => {
      if (path.endsWith('-response.txt')) throw new Error(`disk error ${KEY}`);
      return origWrite(path, text);
    };
    const runner = make((async () => claudeOk(resp('run-1'))) as unknown as typeof fetch);
    await (await runner.exec(req(noticeId))).done;
    expect(pushed.at(-1)).toMatchObject({ status: 'failed', error: { code: 'AI_HTTP' } });
    expect(pushed.at(-1)!.error!.message).not.toContain(KEY);
    expect((await review()).runs[0]).toMatchObject({ status: 'failed', error: { code: 'AI_HTTP' } });
    store.writeText = origWrite;

    // failRun까지 실패: run은 requesting으로 남지만 failed push는 나간다
    const s2 = await setup();
    s2.store.failReviewWrites = false;
    const runner2 = s2.make((async () => { s2.store.failReviewWrites = true; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    await (await runner2.exec(req(s2.noticeId))).done;
    expect(s2.pushed.at(-1)!.status).toBe('failed');
    expect(runner2.isRunning(s2.noticeId)).toBe(false);
    s2.store.failReviewWrites = false;
    expect((await s2.review()).runs[0]!.status).toBe('requesting');
  });

  /** failRun까지 실패해 requesting으로 남은 고아 run(run-1)을 만든다. */
  async function orphaned() {
    const ctx = await setup();
    const crash = ctx.make((async () => { ctx.store.failReviewWrites = true; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    await (await crash.exec(req(ctx.noticeId))).done;
    ctx.store.failReviewWrites = false;
    expect((await ctx.review()).runs[0]!.status).toBe('requesting');
    ctx.pushed.length = 0;
    return ctx;
  }
  const interrupted = { status: 'failed', error: { code: 'AI_INTERRUPTED', message: '실행이 중단되었습니다. 다시 실행하세요' } };

  it('고아 requesting run은 get 시작 시 AI_INTERRUPTED로 닫고 failed를 push한다(offscreen 재시작 = 새 러너)', async () => {
    const { noticeId, pushed, make } = await orphaned();
    const got = await make((async () => claudeOk('')) as unknown as typeof fetch).get(noticeId);
    expect(got!.runs[0]).toMatchObject(interrupted);
    expect(pushed).toEqual([expect.objectContaining({ runId: 'run-1', status: 'failed', error: expect.objectContaining({ code: 'AI_INTERRUPTED' }) })]);
  });

  it('prepare 시작 시에도 고아를 닫는다', async () => {
    const { noticeId, pushed, make, review } = await orphaned();
    const runner = make((async () => claudeOk('')) as unknown as typeof fetch);
    const prepared = await runner.prepare({ noticeId, scope: 'all', provider: 'claude' });
    const runs = (await review()).runs;
    expect(runs.find((r) => r.id === 'run-1')).toMatchObject(interrupted);
    expect(runs.find((r) => r.id === prepared.run.id)!.status).toBe('awaiting');
    expect(pushed).toContainEqual(expect.objectContaining({ runId: 'run-1', status: 'failed' }));
  });

  it('exec 시작 시에도 고아를 닫고 새 실행은 정상 진행한다', async () => {
    const { noticeId, pushed, make, review } = await orphaned();
    const runner = make((async () => claudeOk(resp('run-2'))) as unknown as typeof fetch);
    const { runId, done } = await runner.exec(req(noticeId));
    await done;
    const runs = (await review()).runs;
    expect(runs.find((r) => r.id === 'run-1')).toMatchObject(interrupted);
    expect(runs.find((r) => r.id === runId)!.status).toBe('done');
    expect(pushed.filter((s) => s.runId === 'run-1')).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('살아 있는 실행은 고아로 닫지 않는다(fetch 대기 중)', async () => {
    const { noticeId, make, review } = await setup();
    const g = gate();
    const runner = make((async () => { await g.p; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    const { done } = await runner.exec(req(noticeId));
    await new Promise((r) => setTimeout(r, 20));
    await runner.get(noticeId);
    expect((await review()).runs[0]!.status).toBe('requesting');
    g.release();
    await done;
    expect((await review()).runs[0]!.status).toBe('done');
  });

  it("prepare 중(Map의 runId가 빈 문자열)에는 이미 저장된 requesting run도 닫지 않는다", async () => {
    const { store, noticeId, pushed, make, review } = await setup();
    // run을 ai-review.json에 쓴 직후 멈춘다: 이때 Map의 runId는 아직 ''
    const written = gate();
    const hold = gate();
    const orig = store.writeText.bind(store);
    store.writeText = async (path: string, text: string) => {
      await orig(path, text);
      if (path.endsWith('/ai-review.json')) { written.release(); await hold.p; }
    };
    const g = gate();
    const runner = make((async () => { await g.p; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    const execP = runner.exec(req(noticeId));
    await written.p;
    expect((await review()).runs[0]).toMatchObject({ id: 'run-1', status: 'requesting' });
    await runner.get(noticeId);
    expect((await review()).runs[0]!.status).toBe('requesting');
    expect(pushed.some((s) => s.status === 'failed')).toBe(false);
    store.writeText = orig;
    hold.release();
    const { done } = await execP;
    g.release();
    await done;
    expect((await review()).runs[0]!.status).toBe('done');
  });

  it('get의 load를 기다리는 사이 exec가 만든 run은 load가 풀려도 닫히지 않는다', async () => {
    const { store, noticeId, pushed, make, review } = await setup();
    const hold = gate();
    let armed = false;
    const orig = store.readText.bind(store);
    store.readText = async (path: string) => {
      if (armed && path.endsWith('/ai-review.json')) { armed = false; await hold.p; }
      return orig(path);
    };
    const g = gate();
    const runner = make((async () => { await g.p; return claudeOk(resp('run-1')); }) as unknown as typeof fetch);
    armed = true;
    const getP = runner.get(noticeId); // sweepOrphans의 ai-review.json 읽기에서 멈춘다
    await new Promise((r) => setTimeout(r, 20));
    const { done } = await runner.exec(req(noticeId)); // 그 사이 살아 있는 run 등록
    await new Promise((r) => setTimeout(r, 20));
    hold.release();
    await getP;
    expect((await review()).runs[0]).toMatchObject({ id: 'run-1', status: 'requesting' });
    expect(pushed.some((s) => s.status === 'failed')).toBe(false);
    g.release();
    await done;
    expect((await review()).runs[0]!.status).toBe('done');
  });
});

describe('AiRunner outcome와 keys', () => {
  it('done은 AiRunOutcome: 성공 done+run, API 실패 failed+error, 취소 cancelled', async () => {
    const { noticeId, make } = await setup();
    const ok = await (await make((async () => claudeOk(resp('run-1'))) as unknown as typeof fetch).exec(req(noticeId))).done;
    expect(ok).toMatchObject({ status: 'done', run: { id: 'run-1', status: 'done' } });

    const s2 = await setup();
    const bad = await (await s2.make((async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 401 })) as unknown as typeof fetch).exec(req(s2.noticeId))).done;
    expect(bad).toMatchObject({ status: 'failed', error: { code: 'AI_AUTH' } });

    const s3 = await setup();
    const runner = s3.make(((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => {
      (init.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch);
    const { runId, done } = await runner.exec(req(s3.noticeId));
    await new Promise((r) => setTimeout(r, 20));
    await runner.cancel({ noticeId: s3.noticeId, runId });
    expect(await done).toMatchObject({ status: 'cancelled' });
  });

  it('예외 경로(저장소 오류)는 failed + error(키 가림)', async () => {
    const { store, noticeId, make } = await setup();
    const orig = store.writeText.bind(store);
    store.writeText = async (p: string, t: string) => { if (p.endsWith('-response.txt')) throw new Error(`disk ${KEY}`); return orig(p, t); };
    const out = await (await make((async () => claudeOk(resp('run-1'))) as unknown as typeof fetch).exec(req(noticeId))).done;
    expect(out.status).toBe('failed');
    expect(out.error!.message).not.toContain(KEY);
  });

  it('exec·prepare가 keys를 prepareRun에 전달한다(scope keys, auto)', async () => {
    const { noticeId, make, review } = await setup();
    const runner = make((async () => claudeOk(resp('run-1'))) as unknown as typeof fetch);
    const { done } = await runner.exec({ ...req(noticeId), scope: 'keys', keys: ['credibilityScore'] });
    await done;
    expect((await review()).runs[0]).toMatchObject({ scope: 'keys', keys: ['credibilityScore'] });
    const prepared = await runner.prepare({ noticeId, scope: 'keys', keys: ['performancePeriod'], provider: 'claude' });
    expect(prepared.run).toMatchObject({ scope: 'keys', keys: ['performancePeriod'] });
    const auto = await runner.prepare({ noticeId, scope: 'auto', provider: 'claude' });
    expect(['pending', 'all']).toContain(auto.run.scope);
  });
});

describe('AiRunner 전문 전송 실패', () => {
  it('전문 전송이 400(AI_BAD_REQUEST)이어도 자동 재시도하지 않는다: fetch 1번, failed, 새 run 없음', async () => {
    const { noticeId, make, review } = await setup();
    let calls = 0;
    const runner = make((async () => { calls++; return new Response(JSON.stringify({ error: { message: 'x' } }), { status: 400 }); }) as unknown as typeof fetch);
    const out = await (await runner.exec(req(noticeId))).done;
    expect(calls).toBe(1);
    expect(out).toMatchObject({ status: 'failed', error: { code: 'AI_BAD_REQUEST' } });
    const runs = (await review()).runs;
    expect(runs.map((r) => r.id)).toEqual(['run-1']);
    expect(runs[0]).toMatchObject({ status: 'failed' });
  });
});

describe('AiRunner 비교 실행', () => {
  const okFor = (url: string, text: string): Response => {
    if (url.includes('openai')) return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200 });
    if (url.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
    return claudeOk(text);
  };
  /** 지금 실행 중인 run = 마지막 preparing push의 runId */
  let pushedRef: AiRunState[] = [];
  const runIdOf = (_init: RequestInit) => pushedRef.filter((s) => s.status === 'preparing').at(-1)!.runId;
  const targets = (ps: Array<'claude' | 'openai' | 'gemini'>) => ps.map((provider) => ({ provider, api: { key: KEY, model: 'm' } }));
  const creq = (noticeId: string, ps: Array<'claude' | 'openai' | 'gemini'> = ['claude', 'openai', 'gemini']) =>
    ({ noticeId, scope: 'all' as const, compareId: 'cmp-1', targets: targets(ps) });

  it('공급자를 순차 실행하고 각 run에 compareId, 2번째부터는 첫 run의 keys로 고정, push의 compare.index가 0,1,2', async () => {
    const { noticeId, pushed, make, review } = await setup();
    pushedRef = pushed;
    let open = 0; let maxOpen = 0; const order: string[] = [];
    const runner = make((async (url: string, init: RequestInit) => {
      open++; maxOpen = Math.max(maxOpen, open); order.push(url);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return okFor(url, resp(runIdOf(init)));
    }) as unknown as typeof fetch);
    const { compareId, runId, done } = await runner.execCompare(creq(noticeId));
    expect(compareId).toBe('cmp-1');
    const outs = await done;
    expect(outs.map((o) => o.status)).toEqual(['done', 'done', 'done']);
    expect(maxOpen).toBe(1);
    expect(order.map((u) => (u.includes('anthropic') ? 'claude' : u.includes('openai') ? 'openai' : 'gemini'))).toEqual(['claude', 'openai', 'gemini']);
    const ours = (await review()).runs.filter((r) => r.compareId === 'cmp-1');
    expect(ours).toHaveLength(3);
    const first = ours.find((r) => r.id === runId)!;
    expect(first.provider).toBe('claude');
    for (const r of ours.filter((x) => x.id !== runId)) expect(r).toMatchObject({ scope: 'keys', keys: first.keys });
    expect([...new Set(pushed.map((s) => s.compare?.index))]).toEqual([0, 1, 2]);
    expect(pushed.every((s) => s.compare?.id === 'cmp-1' && s.compare.providers.join() === 'claude,openai,gemini')).toBe(true);
    expect(runner.isRunning(noticeId)).toBe(false);
  });

  it('2번째 공급자 API 실패여도 3번째를 실행한다(outcomes 3개)', async () => {
    const { noticeId, pushed, make } = await setup();
    pushedRef = pushed;
    const runner = make((async (url: string, init: RequestInit) => {
      if (url.includes('openai')) return new Response(JSON.stringify({ error: { message: 'no' } }), { status: 401 });
      return okFor(url, resp(runIdOf(init)));
    }) as unknown as typeof fetch);
    const outs = await (await runner.execCompare(creq(noticeId))).done;
    expect(outs.map((o) => o.status)).toEqual(['done', 'failed', 'done']);
    expect(outs[1]!.error!.code).toBe('AI_AUTH');
  });

  it('시리즈 중 exec, prepare, execCompare는 AI_RUN_BUSY, 끝나면 Map을 비운다', async () => {
    const { noticeId, pushed, make } = await setup();
    pushedRef = pushed;
    const g = gate();
    const runner = make((async (url: string, init: RequestInit) => { await g.p; return okFor(url, resp(runIdOf(init))); }) as unknown as typeof fetch);
    const { done } = await runner.execCompare(creq(noticeId, ['claude', 'gemini']));
    await expect(runner.exec(req(noticeId))).rejects.toMatchObject({ code: 'AI_RUN_BUSY' });
    await expect(runner.prepare({ noticeId, scope: 'all', provider: 'claude' })).rejects.toMatchObject({ code: 'AI_RUN_BUSY' });
    await expect(runner.execCompare(creq(noticeId, ['claude', 'gemini']))).rejects.toMatchObject({ code: 'AI_RUN_BUSY' });
    g.release();
    await done;
    expect(runner.isRunning(noticeId)).toBe(false);
  });

  it('1번째 실행 중 cancel하면 1번째 cancelled, 나머지 run은 만들지 않는다', async () => {
    const { noticeId, make, review } = await setup();
    const runner = make(((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => {
      (init.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch);
    const { runId, done } = await runner.execCompare(creq(noticeId));
    await new Promise((r) => setTimeout(r, 20));
    await runner.cancel({ noticeId, runId });
    const outs = await done;
    expect(outs.map((o) => o.status)).toEqual(['cancelled']);
    expect((await review()).runs.filter((r) => r.compareId === 'cmp-1').map((r) => r.id)).toEqual([runId]);
    expect(runner.isRunning(noticeId)).toBe(false);
  });

  it('공급자 1개, 4개, 중복이면 AI_BAD_REQUEST이고 Map을 건드리지 않는다', async () => {
    const { noticeId, make } = await setup();
    const runner = make((async () => claudeOk('')) as unknown as typeof fetch);
    await expect(runner.execCompare(creq(noticeId, ['claude']))).rejects.toMatchObject({ code: 'AI_BAD_REQUEST' });
    await expect(runner.execCompare(creq(noticeId, ['claude', 'claude']))).rejects.toMatchObject({ code: 'AI_BAD_REQUEST' });
    await expect(runner.execCompare({ ...creq(noticeId), targets: [...targets(['claude', 'openai', 'gemini']), ...targets(['claude'])] })).rejects.toMatchObject({ code: 'AI_BAD_REQUEST' });
    expect(runner.isRunning(noticeId)).toBe(false);
  });

  it('2번째 실행 중 get이 와도 비교 소속 requesting run을 고아로 닫지 않는다', async () => {
    const { noticeId, pushed, make, review } = await setup();
    pushedRef = pushed;
    let runnerRef!: AiRunner;
    let swept = false;
    const runner = make((async (url: string, init: RequestInit) => {
      if (!swept && url.includes('generativelanguage')) { swept = true; await runnerRef.get(noticeId); }
      return okFor(url, resp(runIdOf(init)));
    }) as unknown as typeof fetch);
    runnerRef = runner;
    const outs = await (await runner.execCompare(creq(noticeId, ['claude', 'gemini']))).done;
    expect(outs.map((o) => o.status)).toEqual(['done', 'done']);
    expect((await review()).runs.filter((r) => r.compareId === 'cmp-1').every((r) => r.status === 'done')).toBe(true);
  });
});
