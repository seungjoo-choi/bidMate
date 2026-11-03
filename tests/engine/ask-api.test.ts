import { describe, expect, it, vi } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { ASK_FULL_MAX_CHARS, ASK_MAX_RECORDS } from '../../src/core/search/constants';
import type { ExtractionFile } from '../../src/core/types/extraction';
import type { AskFile, AskRecord } from '../../src/core/types/search';
import { askNotice, getAsks, type AskInput } from '../../src/engine/search/ask-api';
import { AskRunner } from '../../src/engine/search/ask-runner';
import { askFilePath, askPromptPath, askResponsePath } from '../../src/engine/search/search-store';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const ID = 'R26BK00000001-000';
const FOLDER = 'notices/A';
const T = `${FOLDER}/source/text`;
const KEY = 'AQ.secret-key-1234567890';
const NOTE = { textPath: `${T}/1.txt`, quote: '사업기간은 계약일로부터 12개월이다.' };
const file = (n: number, extra: Partial<ExtractionFile> = {}): ExtractionFile => ({
  attachmentId: `a${n}`, name: `file${n}.hwp`, docKind: 'rfp', priority: n, status: 'parsed', textPath: `${T}/${n}.txt`, ...extra,
});

async function seed(texts: Record<string, string> = { [NOTE.textPath]: `[p 1]\n${NOTE.quote}\n입찰보증금은 면제한다.` }) {
  const store = new MemoryStore();
  const n = emptyNotice(ID, { noticeNo: 'R26BK00000001', round: '000' } as never, FOLDER, '2026-10-22T00:00:00+09:00');
  await new NoticeStore(store).saveNotice(n);
  store.files.set(`${FOLDER}/extraction.json`, JSON.stringify({ schemaVersion: 2, noticeId: ID, jobId: 'job1', extractedAt: '', rulesVersion: 'x', status: 'ok', items: {}, extras: {}, files: [file(1)], warnings: [] }));
  for (const [p, t] of Object.entries(texts)) store.files.set(p, t);
  return store;
}

const answerJson = (askId: string, extra: object = {}) => JSON.stringify({
  schema: 'bidmate-search-ask/1', runId: askId, answer: '12개월입니다.', coverage: 'answered',
  citations: [{ file: 'file1.hwp', page: 1, quote: NOTE.quote, note: '' }], conflicts: [], ...extra,
});
const geminiOk = (text: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
}), { status: 200 });
const fetchOf = (impl: () => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const hang = () => vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
  const sig = init!.signal!;
  if (sig.aborted) rej(new DOMException('aborted', 'AbortError'));
  sig.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
})) as unknown as typeof fetch;

const input = (o: Partial<AskInput> = {}): AskInput => ({
  noticeId: ID, askId: 'ask1', question: '사업 기간은 얼마인가요?', fieldDocText: '[기본]\n사업명: 테스트', provider: 'gemini',
  api: { key: KEY, model: 'gemini-test' }, contextMode: 'context', fetch: fetchOf(async () => geminiOk(answerJson('ask1'))), ...o,
});
const deps = { retryDelayMs: 1 };
const asks = async (store: MemoryStore): Promise<AskFile> => JSON.parse(await store.readText(askFilePath(FOLDER))) as AskFile;

describe('askNotice', () => {
  it('성공: asks.json과 prompt·response txt를 저장하고 인용 위치를 찾는다. 키는 어디에도 남지 않는다', async () => {
    const store = await seed();
    const rec = await askNotice(store, input(), deps);
    expect(rec).toMatchObject({ id: 'ask1', status: 'done', coverage: 'answered', answer: '12개월입니다.', provider: 'gemini', extractionJobId: 'job1', usage: { inputTokens: 100, outputTokens: 20 } });
    expect(rec.citations[0]!.located).toMatchObject({ textPath: NOTE.textPath, line: 2, page: 1 });
    expect(rec.files.map((f) => f.name)).toEqual(['공고정보 항목값', 'file1.hwp']);
    const saved = await asks(store);
    expect(saved.asks.map((a) => a.id)).toEqual(['ask1']);
    expect(rec.promptPath).toBe(askPromptPath(FOLDER, 'ask1'));
    expect(rec.responsePath).toBe(askResponsePath(FOLDER, 'ask1'));
    expect(await store.readText(askPromptPath(FOLDER, 'ask1'))).toContain('사업 기간은 얼마인가요?');
    expect(await store.readText(askResponsePath(FOLDER, 'ask1'))).toContain('12개월');
    for (const v of store.files.values()) expect(typeof v === 'string' ? v : new TextDecoder().decode(v)).not.toContain(KEY);
    expect((await getAsks(store, ID))!.asks).toHaveLength(1);
  });

  it('실패(HTTP 401)도 status failed로 저장하고 응답 txt는 없다', async () => {
    const store = await seed();
    const rec = await askNotice(store, input({ fetch: fetchOf(async () => new Response(JSON.stringify({ error: { message: `bad ${KEY}` } }), { status: 401 })) }), deps);
    expect(rec).toMatchObject({ status: 'failed', error: { code: 'AI_AUTH' } });
    expect(rec.error!.message).not.toContain(KEY);
    expect((await asks(store)).asks[0]!.status).toBe('failed');
    expect(store.files.has(askPromptPath(FOLDER, 'ask1'))).toBe(true);
    expect(store.files.has(askResponsePath(FOLDER, 'ask1'))).toBe(false);
  });

  it('취소(signal)면 저장 없이 AI_RUN_CLOSED를 던진다', async () => {
    const store = await seed();
    const ac = new AbortController();
    const p = askNotice(store, input({ fetch: hang(), signal: ac.signal }), deps);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: 'AI_RUN_CLOSED' });
    expect(store.files.has(askFilePath(FOLDER))).toBe(false);
    expect(store.files.has(askPromptPath(FOLDER, 'ask1'))).toBe(false);
  });

  it('공급자 응답 실패 직후 취소됐으면 failed 기록도 prompt txt도 남기지 않는다', async () => {
    const store = await seed();
    const ac = new AbortController();
    const f = fetchOf(async () => { ac.abort(); return new Response('{}', { status: 401 }); });
    await expect(askNotice(store, input({ fetch: f, signal: ac.signal }), deps)).rejects.toMatchObject({ code: 'AI_RUN_CLOSED' });
    expect(store.files.has(askFilePath(FOLDER))).toBe(false);
    expect(store.files.has(askPromptPath(FOLDER, 'ask1'))).toBe(false);
  });

  it('항목값 문서의 문장도 인용 위치를 찾는다(docId fields)', async () => {
    const store = await seed();
    const cite = JSON.stringify({ schema: 'bidmate-search-ask/1', runId: 'ask1', answer: 'x', coverage: 'answered', citations: [{ file: '공고정보 항목값', page: null, quote: '사업명: 테스트 용역 사업 수행 계획', note: '' }], conflicts: [] });
    const rec = await askNotice(store, input({ fieldDocText: '[기본]\n사업명: 테스트 용역 사업 수행 계획', fetch: fetchOf(async () => geminiOk(cite)) }), deps);
    expect(rec.citations[0]!.located).toMatchObject({ docId: 'fields', line: 2 });
  });

  it('30건 초과 시 오래된 기록과 txt를 지운다', async () => {
    const store = await seed();
    const old = (i: number): AskRecord => ({
      id: `old${i}`, createdAt: '2026-10-01T00:00:00+09:00', question: 'q', provider: 'gemini', model: 'm', promptVersion: '1', contextMode: 'context', contextChars: 0,
      files: [], status: 'done', citations: [], conflicts: [], warnings: [], promptPath: askPromptPath(FOLDER, `old${i}`), extractionJobId: null,
    });
    const list = Array.from({ length: ASK_MAX_RECORDS }, (_, i) => old(i)); // old0이 최신, old29가 가장 오래됨
    store.files.set(askFilePath(FOLDER), JSON.stringify({ schemaVersion: 1, noticeId: ID, asks: list }));
    for (const r of [list[29]!, list[0]!]) { store.files.set(askPromptPath(FOLDER, r.id), 'p'); store.files.set(askResponsePath(FOLDER, r.id), 'r'); }
    await askNotice(store, input(), deps);
    const saved = await asks(store);
    expect(saved.asks).toHaveLength(ASK_MAX_RECORDS);
    expect(saved.asks[0]!.id).toBe('ask1');
    expect(saved.asks.some((a) => a.id === 'old29')).toBe(false);
    expect(store.files.has(askPromptPath(FOLDER, 'old29'))).toBe(false);
    expect(store.files.has(askResponsePath(FOLDER, 'old29'))).toBe(false);
    expect(store.files.has(askPromptPath(FOLDER, 'old0'))).toBe(true);
  });

  it('full 모드가 상한을 넘으면 context로 돌아가고 warning을 남긴다', async () => {
    const big = Array.from({ length: Math.ceil(ASK_FULL_MAX_CHARS / 50) + 10 }, (_, i) => `줄 ${i} ${'가'.repeat(44)}`).join('\n');
    const store = await seed({ [NOTE.textPath]: big });
    const rec = await askNotice(store, input({ contextMode: 'full' }), deps);
    expect(rec.contextMode).toBe('context');
    expect(rec.warnings.some((w) => w.includes('관련 부분만'))).toBe(true);
    const small = await askNotice(await seed(), input({ contextMode: 'full', askId: 'ask2', fetch: fetchOf(async () => geminiOk(answerJson('ask2'))) }), deps);
    expect(small.contextMode).toBe('full');
    expect(small.warnings).toEqual([]);
  });
});

describe('AskRunner', () => {
  it('공고당 1개만 실행하고 이미 실행 중이면 SEARCH_ASK_BUSY, cancel은 askId가 맞을 때만 중단한다', async () => {
    const store = await seed();
    const runner = new AskRunner({ store, fetch: hang(), retryDelayMs: 1 });
    const { askId: _a, fetch: _f, ...req } = input();
    const first = runner.exec({ ...req, askId: 'ask1' });
    first.catch(() => undefined);
    await vi.waitFor(() => expect(runner.isRunning(ID)).toBe(true));
    await expect(runner.exec({ ...req, askId: 'ask2' })).rejects.toMatchObject({ code: 'SEARCH_ASK_BUSY' });
    expect(runner.cancel({ noticeId: ID, askId: 'other' })).toEqual({ cancelled: false });
    expect(runner.cancel({ noticeId: ID, askId: 'ask1' })).toEqual({ cancelled: true });
    await expect(first).rejects.toMatchObject({ code: 'AI_RUN_CLOSED' });
    expect(runner.isRunning(ID)).toBe(false);
    expect(runner.cancel({ noticeId: ID, askId: 'ask1' })).toEqual({ cancelled: false });
  });
});
