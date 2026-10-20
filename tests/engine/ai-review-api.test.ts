import { describe, expect, it } from 'vitest';
import { loadRules } from '../../src/core/extraction/rules/load';
import { pendingKeys } from '../../src/core/extraction/review-count';
import type { AiReviewFile } from '../../src/core/types/ai';
import type { Extraction } from '../../src/core/types/extraction';
import type { Notice } from '../../src/core/types/notice';
import {
  applySuggestion, cancelRunState, dismissSuggestion, execApiRun, finishRun, getPrompt, prepareRun, type AiApiDeps,
} from '../../src/engine/ai/ai-review-api';
import { editExtraction } from '../../src/engine/notices/notice-api';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { docOf, fakeParsers, readJsonFile, runCollect } from '../helpers/extract-harness';
import type { MemoryStore } from '../helpers/memory-store';

const API_KEY = 'sk-ant-SECRET-KEY-1234567890';
const LINES = [
  '평가항목 안내입니다 정량평가 기준표',
  '신용평가 배점 10점 (신용평가 항목 기준표)',
  '수행실적 인정기간은 공고일 기준 최근 5년간으로 한다',
];
const Q_CRED = '신용평가 배점 10점 (신용평가 항목 기준표)';
const files = { '1. 입찰공고문.hwp': 'x' };
const parsers = fakeParsers(async () => docOf(...LINES));

async function setup() {
  const { store } = await runCollect({ files, parsers });
  const noticeId = readJsonFile<Notice>(store, '/notice.json').id;
  let n = 0;
  const deps: AiApiDeps = { rules: loadRules(), newId: () => `run-${++n}` };
  return { store, noticeId, deps };
}
const fileKey = (store: MemoryStore, suffix: string) => [...store.files.keys()].find((k) => k.endsWith(suffix))!;
const resp = (runId: string, items: unknown[]) => JSON.stringify({ schema: 'bidmate-ai-review/1', runId, items });
const goodItems = [
  { key: 'credibilityScore', value: 10, quote: Q_CRED, file: '1. 입찰공고문.hwp', page: null, note: '' },
  { key: 'managementScore', value: 5, quote: '문서에 전혀 없는 문장입니다 정말로', file: null, page: null },
];
const claudeOk = (text: string) => new Response(JSON.stringify({
  content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 },
}), { status: 200 });

async function review(store: MemoryStore, noticeId: string): Promise<AiReviewFile> {
  const ns = new NoticeStore(store);
  const n = (await ns.loadNotice(noticeId))!;
  return JSON.parse(await store.readText(`${n.folder}/ai-review.json`)) as AiReviewFile;
}

describe('prepareRun', () => {
  it('pending은 확인 필요 키만, all은 7개 전부를 대상으로 한다', async () => {
    const { store, noticeId, deps } = await setup();
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    const p = await prepareRun(store, { noticeId, scope: 'pending', provider: 'claude', mode: 'api', model: 'm' }, deps);
    expect(p.run.keys).toEqual(pendingKeys(x.items));
    expect(p.run).toMatchObject({ status: 'requesting', model: 'm', provider: 'claude', extractionJobId: x.jobId });
    const a = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, deps);
    expect(a.run.keys).toHaveLength(7);
    expect(await store.readText(a.run.promptPath)).toContain('신용평가 배점 10점');
    expect((await review(store, noticeId)).runs.map((r) => r.id)).toEqual(['run-2', 'run-1']);
  });

  it('manual은 awaiting + model null, 같은 공고의 이전 awaiting run은 cancelled', async () => {
    const { store, noticeId, deps } = await setup();
    const a = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: 'ignored' }, deps);
    expect(a.run).toMatchObject({ status: 'awaiting', model: null });
    expect(a.built.manualText.split('\n')[0]).toContain('<<BIDMATE-AI-REQUEST runId=run-1');
    await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, deps);
    const runs = (await review(store, noticeId)).runs;
    expect(runs.find((r) => r.id === 'run-1')).toMatchObject({ status: 'cancelled' });
    expect(runs.find((r) => r.id === 'run-2')!.status).toBe('awaiting');
    expect((await getPrompt(store, { noticeId, runId: 'run-2' })).text).toContain('BIDMATE-AI-REQUEST');
  });

  it('스캔 문서는 skipped로 기록하고 프롬프트에 제외 안내를 넣는다', async () => {
    const { store, noticeId, deps } = await setup();
    const k = fileKey(store, '/extraction.json');
    const x = JSON.parse(store.files.get(k) as string) as Extraction;
    x.files.push({ attachmentId: 'zz', name: 'scan.pdf', docKind: 'other', priority: 3, status: 'scanned' });
    store.files.set(k, JSON.stringify(x));
    const p = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, deps);
    expect(p.run.skipped).toContainEqual({ name: 'scan.pdf', reason: 'scanned' });
    expect(p.built.manualText).toContain('scan.pdf');
    expect(p.stats.excludedFiles).toEqual(['scan.pdf']);
  });

  it('같은 공고 잡 실행 중이면 거부, 공고 없음은 NOT_FOUND, files가 비면 NO_DOCUMENTS', async () => {
    const { store, noticeId, deps } = await setup();
    await expect(prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm', files: [] }, deps)).rejects.toMatchObject({ code: 'NO_DOCUMENTS' });
    await expect(prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, { ...deps, isBusy: () => true })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    await expect(prepareRun(store, { noticeId: 'none', scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, deps)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('finishRun / 반자동 제출', () => {
  it('정상 응답은 done, 검증 실패는 rejected로 분리하고 응답 txt를 남긴다', async () => {
    const { store, noticeId, deps } = await setup();
    const p = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, deps);
    const f = await finishRun(store, { noticeId, runId: p.run.id, responseText: `\`\`\`json\n${resp(p.run.id, goodItems)}\n\`\`\`` }, deps);
    const run = f.runs[0]!;
    expect(run.status).toBe('done');
    expect(run.suggestions.credibilityScore).toMatchObject({ value: 10, verdict: expect.stringMatching(/new|match|differs/), valueInQuote: true });
    expect(run.rejected).toEqual([expect.objectContaining({ key: 'managementScore', reason: 'quote_not_found' })]);
    expect(await store.readText(run.responsePath!)).toContain('credibilityScore');
    // extraction은 적용 전에 바뀌지 않는다
    expect(readJsonFile<Extraction>(store, '/extraction.json').items.credibilityScore.userEdited).toBeUndefined();
  });

  it('요청문을 붙여넣거나 runId가 다르면 오류만 던지고 run은 열려 있다', async () => {
    const { store, noticeId, deps } = await setup();
    const p = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, deps);
    await expect(finishRun(store, { noticeId, runId: p.run.id, responseText: p.built.manualText }, deps)).rejects.toMatchObject({ code: 'AI_CLIPBOARD_IS_PROMPT' });
    await expect(finishRun(store, { noticeId, runId: p.run.id, responseText: resp('other', goodItems) }, deps)).rejects.toMatchObject({ code: 'AI_RUN_MISMATCH' });
    expect((await review(store, noticeId)).runs[0]!.status).toBe('awaiting');
    await finishRun(store, { noticeId, runId: p.run.id, responseText: resp(p.run.id, goodItems) }, deps);
    await expect(finishRun(store, { noticeId, runId: p.run.id, responseText: resp(p.run.id, goodItems) }, deps)).rejects.toMatchObject({ code: 'AI_RUN_CLOSED' });
  });

  it('실행 중 재추출됐으면 warning을 남긴다', async () => {
    const { store, noticeId, deps } = await setup();
    const p = await prepareRun(store, { noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, deps);
    const k = fileKey(store, '/extraction.json');
    const x = JSON.parse(store.files.get(k) as string) as Extraction;
    x.jobId = 'job-new';
    store.files.set(k, JSON.stringify(x));
    const f = await finishRun(store, { noticeId, runId: p.run.id, responseText: resp(p.run.id, goodItems) }, deps);
    expect(f.runs[0]!.warnings.some((w) => w.includes('다시 추출'))).toBe(true);
  });
});

describe('applySuggestion / dismissSuggestion', () => {
  async function done() {
    const ctx = await setup();
    const p = await prepareRun(ctx.store, { noticeId: ctx.noticeId, scope: 'all', provider: 'claude', mode: 'manual', model: null }, ctx.deps);
    await finishRun(ctx.store, { noticeId: ctx.noticeId, runId: p.run.id, responseText: resp(p.run.id, goodItems) }, ctx.deps);
    return { ...ctx, runId: p.run.id };
  }

  it('origin·source ref·appliedAt을 남기고 verified로 바꾸지 않으며, 되돌리기가 된다', async () => {
    const { store, noticeId, deps, runId } = await done();
    const r = await applySuggestion(store, { noticeId, runId, key: 'credibilityScore' }, deps);
    const item = r.extraction.items.credibilityScore;
    expect(item.userEdited).toMatchObject({ value: 10, origin: { kind: 'ai', runId, provider: 'claude', model: null, promptVersion: '1.0.0' } });
    expect(item.userEdited!.note).toContain('AI 제안 적용(Claude');
    expect(r.notice.evaluation.credibilityScore).toMatchObject({ value: 10, status: 'user_edited', source: { kind: 'user', ref: `ai:${runId}` } });
    expect(r.aiReview.runs[0]!.suggestions.credibilityScore!.appliedAt).toBeTruthy();
    const back = await editExtraction(store, { noticeId, key: 'credibilityScore', value: null });
    expect(back.extraction.items.credibilityScore.userEdited).toBeUndefined();
  });

  it('사용자 note가 있으면 기본 메모 대신 쓴다', async () => {
    const { store, noticeId, deps, runId } = await done();
    const r = await applySuggestion(store, { noticeId, runId, key: 'credibilityScore', note: '직접' }, deps);
    expect(r.extraction.items.credibilityScore.userEdited!.note).toBe('직접');
  });

  it('dismissed·없는 제안·none 제안·rejected 키는 AI_SUGGESTION_INVALID', async () => {
    const { store, noticeId, deps, runId } = await done();
    await dismissSuggestion(store, { noticeId, runId, key: 'credibilityScore' }, deps);
    await expect(applySuggestion(store, { noticeId, runId, key: 'credibilityScore' }, deps)).rejects.toMatchObject({ code: 'AI_SUGGESTION_INVALID' });
    await expect(applySuggestion(store, { noticeId, runId, key: 'managementScore' }, deps)).rejects.toMatchObject({ code: 'AI_SUGGESTION_INVALID' });
    await expect(applySuggestion(store, { noticeId, runId: 'nope', key: 'credibilityScore' }, deps)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('editExtraction expectJobId 불일치는 AI_STALE이고 notice·extraction은 바뀌지 않는다', async () => {
    const { store, noticeId } = await done();
    const before = [fileKey(store, '/extraction.json'), fileKey(store, '/notice.json')].map((k) => store.files.get(k));
    const jobId = readJsonFile<Extraction>(store, '/extraction.json').jobId;
    await expect(editExtraction(store, { noticeId, key: 'credibilityScore', value: 10 }, { expectJobId: 'other-job' })).rejects.toMatchObject({ code: 'AI_STALE' });
    expect([fileKey(store, '/extraction.json'), fileKey(store, '/notice.json')].map((k) => store.files.get(k))).toEqual(before);
    await expect(editExtraction(store, { noticeId, key: 'credibilityScore', value: 10 }, { expectJobId: jobId })).resolves.toBeTruthy();
  });

  it('재추출로 jobId가 바뀌면 AI_STALE, 잡 실행 중이면 JOB_ALREADY_RUNNING', async () => {
    const { store, noticeId, deps, runId } = await done();
    await expect(applySuggestion(store, { noticeId, runId, key: 'credibilityScore' }, { ...deps, isBusy: () => true })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    const k = fileKey(store, '/extraction.json');
    const x = JSON.parse(store.files.get(k) as string) as Extraction;
    x.jobId = 'job-new';
    store.files.set(k, JSON.stringify(x));
    await expect(applySuggestion(store, { noticeId, runId, key: 'credibilityScore' }, deps)).rejects.toMatchObject({ code: 'AI_STALE' });
  });
});

describe('execApiRun / cancel / 키 비노출', () => {
  const run = async (fetchFn: typeof fetch, signal?: AbortSignal) => {
    const ctx = await setup();
    const prepared = await prepareRun(ctx.store, { noticeId: ctx.noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'claude-x' }, ctx.deps);
    const statuses: string[] = [];
    const out = await execApiRun(ctx.store, { prepared, apiKey: API_KEY, model: 'claude-x', fetch: fetchFn, signal, retryDelayMs: 1, onStatus: (s) => statuses.push(s) }, ctx.deps);
    return { ...ctx, prepared, out, statuses };
  };
  const allText = (store: MemoryStore) => [...store.files.values()].map((v) => (typeof v === 'string' ? v : new TextDecoder().decode(v))).join('\n');

  it('성공하면 done, usage 기록, 키는 어디에도 저장되지 않는다', async () => {
    let sent: { headers: Record<string, string>; body: string } | undefined;
    const fetchFn = (async (_u: string, init: RequestInit) => { sent = { headers: init.headers as Record<string, string>, body: String(init.body) }; return claudeOk(resp('run-1', goodItems)); }) as unknown as typeof fetch;
    const { store, out, statuses } = await run(fetchFn);
    expect(sent!.headers['x-api-key']).toBe(API_KEY);
    expect(sent!.body).not.toContain(API_KEY);
    expect(out!.runs[0]).toMatchObject({ status: 'done', usage: { inputTokens: 11, outputTokens: 7 }, model: 'claude-x' });
    expect(statuses).toEqual(['requesting', 'verifying']);
    expect(allText(store)).not.toContain(API_KEY);
  });

  it('401은 failed(AI_AUTH), 오류 메시지에 키가 있어도 가려진다', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { type: 'authentication_error', message: `invalid x-api-key ${API_KEY}` } }), { status: 401 })) as unknown as typeof fetch;
    const { store, out } = await run(fetchFn);
    expect(out!.runs[0]).toMatchObject({ status: 'failed', error: { code: 'AI_AUTH' } });
    expect(JSON.stringify(out)).not.toContain(API_KEY);
    expect(allText(store)).not.toContain(API_KEY);
  });

  it('응답이 깨졌으면 failed(AI_BAD_RESPONSE)이고 응답 원문 txt가 남는다', async () => {
    const { out } = await run((async () => claudeOk('JSON 아님')) as unknown as typeof fetch);
    expect(out!.runs[0]).toMatchObject({ status: 'failed', error: { code: 'AI_BAD_RESPONSE' } });
    expect(out!.runs[0]!.responsePath).toBeTruthy();
  });

  it('길이 제한으로 잘렸어도 파싱되면 반영하고 warning, 파싱 불가면 AI_TRUNCATED', async () => {
    const trunc = (text: string) => (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'max_tokens' }), { status: 200 })) as unknown as typeof fetch;
    const ok = await run(trunc(resp('run-1', goodItems)));
    expect(ok.out!.runs[0]).toMatchObject({ status: 'done' });
    expect(ok.out!.runs[0]!.warnings.some((w) => w.includes('잘렸'))).toBe(true);
    const bad = await run(trunc('{"schema": "bidmate'));
    expect(bad.out!.runs[0]).toMatchObject({ status: 'failed', error: { code: 'AI_TRUNCATED' } });
  });

  it('abort 없이 cancelRunState만 부른 뒤 응답을 풀어 줘도 run은 cancelled 유지, 제안·응답 txt 미반영', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = (async () => { await gate; return claudeOk(resp('run-1', goodItems)); }) as unknown as typeof fetch;
    const ctx = await setup();
    const prepared = await prepareRun(ctx.store, { noticeId: ctx.noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, ctx.deps);
    const p = execApiRun(ctx.store, { prepared, apiKey: API_KEY, model: 'm', fetch: fetchFn }, ctx.deps);
    await cancelRunState(ctx.store, { noticeId: ctx.noticeId, runId: prepared.run.id }, ctx.deps);
    release();
    expect(await p).toBeNull();
    const f = await review(ctx.store, ctx.noticeId);
    expect(f.runs[0]!.status).toBe('cancelled');
    expect(f.runs[0]!.suggestions).toEqual({});
    expect([...ctx.store.files.keys()].some((k) => k.endsWith(`${prepared.run.id}-response.txt`))).toBe(false);
  });

  it('응답 파싱 실패가 아닌 오류(저장소 오류 등)는 run을 닫지 않고 그대로 전파한다', async () => {
    const ctx = await setup();
    const prepared = await prepareRun(ctx.store, { noticeId: ctx.noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, ctx.deps);
    const orig = ctx.store.writeText.bind(ctx.store);
    ctx.store.writeText = async (path: string, text: string) => { if (path.endsWith('-response.txt')) throw Object.assign(new Error('x'), { code: 'DISK_FULL' }); return orig(path, text); };
    await expect(execApiRun(ctx.store, { prepared, apiKey: API_KEY, model: 'm', fetch: (async () => claudeOk(resp('run-1', goodItems))) as unknown as typeof fetch }, ctx.deps)).rejects.toMatchObject({ code: 'DISK_FULL' });
    ctx.store.writeText = orig;
    expect((await review(ctx.store, ctx.noticeId)).runs[0]!.status).toBe('requesting');
  });

  it('실행 중 취소하면 cancelled이고 늦게 온 응답이 run을 덮지 않는다', async () => {
    const ac = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = (async () => { await gate; return claudeOk(resp('run-1', goodItems)); }) as unknown as typeof fetch;
    const ctx = await setup();
    const prepared = await prepareRun(ctx.store, { noticeId: ctx.noticeId, scope: 'all', provider: 'claude', mode: 'api', model: 'm' }, ctx.deps);
    const p = execApiRun(ctx.store, { prepared, apiKey: API_KEY, model: 'm', fetch: fetchFn, signal: ac.signal }, ctx.deps);
    await cancelRunState(ctx.store, { noticeId: ctx.noticeId, runId: prepared.run.id }, ctx.deps);
    ac.abort();
    release();
    await p;
    const f = await review(ctx.store, ctx.noticeId);
    expect(f.runs[0]!.status).toBe('cancelled');
    expect(f.runs[0]!.suggestions).toEqual({});
    expect(await cancelRunState(ctx.store, { noticeId: ctx.noticeId, runId: prepared.run.id }, ctx.deps)).toEqual({ cancelled: false });
  });
});
