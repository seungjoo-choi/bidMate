import { buildExcerpt, type ExcerptFileInput } from '../../core/ai/excerpt';
import { EXCERPT_MAX_CHARS } from '../../core/ai/constants';
import { parseAiResponse } from '../../core/ai/parse';
import { buildPrompt, PROMPT_VERSION, type BuiltPrompt } from '../../core/ai/prompt';
import { verifySuggestions, type VerifyFile } from '../../core/ai/verify';
import { pendingKeys } from '../../core/extraction/review-count';
import { normalizePath } from '../../core/model/path';
import type { AiErrorCode, AiMode, AiProvider, AiReviewFile, AiRun, AiScope } from '../../core/types/ai';
import { EXTRACTION_KEYS, type Extraction, type ExtractionFile, type ExtractionKey } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import type { DocKind } from '../../core/extraction/classify';
import type { IFileStore } from '../file-store/types';
import { editExtraction } from '../notices/notice-api';
import { NoticeStore } from '../notices/notice-store';
import { callProvider, AI_MAX_TOKENS } from './ai-client';
import { aiPromptPath, aiResponsePath, AiReviewStore } from './ai-review-store';
import { getAdapter } from './providers';
import type { AiProviderAdapter } from './providers/types';

type ApiErrCode = AiErrorCode | 'NOT_FOUND' | 'JOB_ALREADY_RUNNING';
const err = (code: ApiErrCode, message: string) => Object.assign(new Error(message), { code });

/** core는 ui를 import하지 않고 engine에도 ui import 전례가 없어 `ui/review/view.ts`와 같은 로직을 여기에 둔다. */
const KIND_LABEL: Record<DocKind, string> = {
  eval_criteria: '평가기준', notice: '공고문', rfp: '제안요청서', qna: '질의답변', other: '기타', form: '양식', reference: '참고',
};
const displayName = (f: ExtractionFile): string => (f.innerPath ? `${f.name} › ${f.innerPath}` : f.name);
const sourceFileOf = (f: ExtractionFile): string => (f.innerPath ? `${f.name}/${f.innerPath}` : f.name);

type SkipReason = AiRun['skipped'][number]['reason'];
const SKIP_BY_STATUS: Partial<Record<ExtractionFile['status'], SkipReason>> = {
  scanned: 'scanned', unsupported: 'unsupported', encrypted: 'encrypted', drm: 'drm', failed: 'failed', corrupt: 'failed', timeout: 'failed',
};
/** 프롬프트에 "읽을 수 없어 제외"로 안내하는 사유(사용자가 직접 뺀 파일은 제외) */
const UNREADABLE: SkipReason[] = ['scanned', 'unsupported', 'encrypted', 'drm', 'failed'];

export interface AiApiDeps {
  rules: { synonyms: Record<string, string[]> };
  now?: () => Date;
  isBusy?: (noticeId: string) => boolean;
  newId?: () => string;
}
export interface PrepareInput { noticeId: string; scope: AiScope; provider: AiProvider; mode: AiMode; model: string | null; /** 사용할 파일의 textPath 목록. 없으면 분석된 전체 */ files?: string[] }
export interface PreparedRun {
  notice: Notice; run: AiRun; built: BuiltPrompt; adapter: AiProviderAdapter;
  stats: { chars: number; files: number; truncated: boolean; excludedFiles: string[] };
}

async function loadNoticeAndExtraction(store: IFileStore, noticeId: string): Promise<{ notice: Notice; extraction: Extraction }> {
  const ns = new NoticeStore(store);
  const notice = await ns.loadNotice(noticeId);
  const extraction = await ns.loadExtraction(noticeId);
  if (!notice || !extraction) throw err('NOT_FOUND', '추출 결과를 찾을 수 없습니다.');
  return { notice, extraction };
}

/** extraction 텍스트 파일은 공고 폴더의 source/text 아래만 읽는다. */
async function readFileText(store: IFileStore, notice: Notice, textPath: string): Promise<string | null> {
  try {
    const path = normalizePath(textPath);
    if (!path.startsWith(`${normalizePath(notice.folder)}/source/text/`)) return null;
    return await store.readText(path);
  } catch (e) {
    if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
    return null;
  }
}

const isOpen = (r: AiRun) => r.status === 'awaiting' || r.status === 'requesting';

/** run 준비: 대상 키 계산 → 발췌 → 프롬프트 txt와 run 저장. 같은 공고의 awaiting run은 cancelled로 바꾼다. */
export async function prepareRun(store: IFileStore, p: PrepareInput, deps: AiApiDeps): Promise<PreparedRun> {
  const adapter = getAdapter(p.provider);
  const now = deps.now ?? (() => new Date());
  const { notice, extraction } = await loadNoticeAndExtraction(store, p.noticeId);
  if (deps.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');

  const keys: ExtractionKey[] = p.scope === 'all' ? [...EXTRACTION_KEYS] : pendingKeys(extraction.items);
  if (keys.length === 0) throw err('NOTHING_TO_REVIEW', '확인이 필요한 항목이 없습니다.');

  const inputs: ExcerptFileInput[] = [];
  const skipped: AiRun['skipped'] = [];
  for (const f of extraction.files) {
    if (f.status === 'parsed' && f.textPath) {
      if (p.files && !p.files.includes(f.textPath)) { skipped.push({ name: displayName(f), reason: 'unselected' }); continue; }
      const text = await readFileText(store, notice, f.textPath);
      if (text === null) { skipped.push({ name: displayName(f), reason: 'failed' }); continue; }
      inputs.push({ attachmentId: f.attachmentId, sourceFile: sourceFileOf(f), name: displayName(f), kindLabel: KIND_LABEL[f.docKind], priority: f.priority, text });
      continue;
    }
    const reason = SKIP_BY_STATUS[f.status];
    if (reason) skipped.push({ name: displayName(f), reason });
  }
  if (inputs.length === 0) throw err('NO_DOCUMENTS', '읽을 수 있는 문서가 없습니다.');

  const excerpt = buildExcerpt({
    files: inputs, synonyms: deps.rules.synonyms,
    maxChars: p.mode === 'manual' ? Math.min(EXCERPT_MAX_CHARS, adapter.manualMaxChars) : EXCERPT_MAX_CHARS,
  });
  const runId = (deps.newId ?? (() => crypto.randomUUID()))();
  const excludedFiles = skipped.filter((s) => UNREADABLE.includes(s.reason)).map((s) => s.name);
  const built = buildPrompt({ runId, keys, excerpt: excerpt.text, skippedFiles: excludedFiles });
  const nowIso = now().toISOString();
  const run: AiRun = {
    id: runId, createdAt: nowIso, provider: p.provider, mode: p.mode, model: p.mode === 'manual' ? null : p.model,
    promptVersion: PROMPT_VERSION, scope: p.scope, keys,
    extractionJobId: extraction.jobId, extractedAt: extraction.extractedAt,
    status: p.mode === 'manual' ? 'awaiting' : 'requesting',
    files: excerpt.files, skipped, excerptChars: excerpt.chars, truncated: excerpt.truncated,
    warnings: [...excerpt.warnings], suggestions: {}, rejected: [],
    promptPath: aiPromptPath(notice.folder, runId),
  };
  const ai = new AiReviewStore(store);
  await ai.writePrompt(notice, runId, p.mode === 'manual' ? built.manualText : `${built.system}\n\n${built.user}`);
  await ai.mutate(notice, (f) => {
    f.runs = f.runs.map((r) => (r.status === 'awaiting' ? { ...r, status: 'cancelled' as const, finishedAt: nowIso } : r));
    f.runs.unshift(run);
  });
  return { notice, run, built, adapter, stats: { chars: excerpt.chars, files: excerpt.files.length, truncated: excerpt.truncated, excludedFiles } };
}

export interface FinishInput {
  noticeId: string; runId: string; responseText: string;
  usage?: { inputTokens: number; outputTokens: number }; warnings?: string[];
}

async function findOpenRun(ai: AiReviewStore, notice: Notice, runId: string): Promise<AiRun> {
  const run = (await ai.load(notice))?.runs.find((r) => r.id === runId);
  if (!run) throw err('NOT_FOUND', '해당 AI 실행을 찾을 수 없습니다.');
  if (!isOpen(run)) throw err('AI_RUN_CLOSED', '이미 닫힌 AI 실행입니다.');
  return run;
}

/**
 * 응답 파싱 → 검증(파일 전체 텍스트) → done 저장. 파싱 실패는 run을 바꾸지 않고 오류만 던진다(반자동은 다시 붙여넣을 수 있다).
 * run이 awaiting/requesting이 아니면 AI_RUN_CLOSED.
 */
export async function finishRun(store: IFileStore, p: FinishInput, deps: AiApiDeps): Promise<AiReviewFile> {
  const now = deps.now ?? (() => new Date());
  const { notice, extraction } = await loadNoticeAndExtraction(store, p.noticeId);
  const ai = new AiReviewStore(store);
  const run = await findOpenRun(ai, notice, p.runId);
  const parsed = parseAiResponse(p.responseText, { runId: run.id, keys: run.keys });
  if (!parsed.ok) throw err(parsed.code, parsed.message);

  const files: VerifyFile[] = [];
  for (const rf of run.files) {
    const ef = extraction.files.find((f) => f.attachmentId === rf.attachmentId && sourceFileOf(f) === rf.sourceFile && f.textPath);
    if (!ef?.textPath) continue;
    const text = await readFileText(store, notice, ef.textPath);
    if (text !== null) files.push({ attachmentId: ef.attachmentId, sourceFile: rf.sourceFile, name: rf.name, docKind: ef.docKind, text });
  }
  const baseline: Partial<Record<ExtractionKey, unknown>> = {};
  for (const k of run.keys) { const it = extraction.items[k]; baseline[k] = it.userEdited ? it.userEdited.value : it.value; }
  const v = verifySuggestions(parsed.items, { files, baseline, requested: run.keys, provider: run.provider, promptVersion: run.promptVersion });

  const warnings = [...run.warnings, ...(p.warnings ?? []), ...v.warnings];
  if (extraction.jobId !== run.extractionJobId) warnings.push('AI가 실행되는 동안 다시 추출되어 이 제안은 현재 추출 결과와 맞지 않을 수 있습니다.');
  const responsePath = aiResponsePath(notice.folder, run.id);
  return ai.mutate(notice, async (f) => {
    const cur = f.runs.find((r) => r.id === run.id);
    if (!cur) throw err('NOT_FOUND', '해당 AI 실행을 찾을 수 없습니다.');
    if (!isOpen(cur)) throw err('AI_RUN_CLOSED', '이미 닫힌 AI 실행입니다.');
    await ai.writeResponse(notice, run.id, p.responseText); // 락 안 상태 확인 뒤에만 쓴다
    Object.assign(cur, {
      status: 'done', finishedAt: now().toISOString(), suggestions: v.suggestions, rejected: v.rejected, warnings, responsePath,
      ...(p.usage ? { usage: p.usage } : {}),
    });
  });
}

/** 열린 run을 failed로 닫는다. 이미 닫혔으면 아무것도 하지 않는다. 응답 원문이 있으면 txt로 남긴다. */
export async function failRun(
  store: IFileStore, p: { noticeId: string; runId: string; error: { code: AiErrorCode; message: string }; responseText?: string }, deps: AiApiDeps,
): Promise<AiReviewFile | null> {
  const now = deps.now ?? (() => new Date());
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) return null;
  const ai = new AiReviewStore(store);
  let responsePath: string | undefined;
  if (p.responseText !== undefined) { await ai.writeResponse(notice, p.runId, p.responseText); responsePath = aiResponsePath(notice.folder, p.runId); }
  return ai.mutate(notice, (f) => {
    const cur = f.runs.find((r) => r.id === p.runId);
    if (!cur || !isOpen(cur)) return;
    Object.assign(cur, { status: 'failed', finishedAt: now().toISOString(), error: p.error, ...(responsePath ? { responsePath } : {}) });
  });
}

/** 열린 run을 cancelled로 닫는다(늦게 온 응답이 덮지 않도록 finish는 status를 다시 본다). */
export async function cancelRunState(store: IFileStore, p: { noticeId: string; runId: string }, deps: AiApiDeps): Promise<{ cancelled: boolean }> {
  const now = deps.now ?? (() => new Date());
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) return { cancelled: false };
  let cancelled = false;
  await new AiReviewStore(store).mutate(notice, (f) => {
    const cur = f.runs.find((r) => r.id === p.runId);
    if (!cur || !isOpen(cur)) return;
    Object.assign(cur, { status: 'cancelled', finishedAt: now().toISOString() });
    cancelled = true;
  });
  return { cancelled };
}

export interface ExecInput {
  prepared: PreparedRun; apiKey: string; model: string; fetch: typeof globalThis.fetch; signal?: AbortSignal;
  onStatus?: (s: 'requesting' | 'verifying') => void; retryDelayMs?: number;
}

/** API 방식 실행: callProvider → finishRun. 실패는 run을 failed로 닫는다. 취소면 cancelled. */
export async function execApiRun(store: IFileStore, x: ExecInput, deps: AiApiDeps): Promise<AiReviewFile | null> {
  const { prepared, signal } = x;
  const base = { noticeId: prepared.notice.id, runId: prepared.run.id };
  x.onStatus?.('requesting');
  const r = await callProvider(
    prepared.adapter,
    { apiKey: x.apiKey, model: x.model, system: prepared.built.system, user: prepared.built.user, spec: prepared.built.spec, maxTokens: AI_MAX_TOKENS },
    { fetch: x.fetch, signal, retryDelayMs: x.retryDelayMs },
  );
  if (signal?.aborted || (!r.ok && r.error.code === 'AI_RUN_CLOSED')) { await cancelRunState(store, base, deps); return null; }
  if (!r.ok) return failRun(store, { ...base, error: { code: r.error.code, message: r.error.message } }, deps);
  x.onStatus?.('verifying');
  const truncated = r.finish === 'length';
  try {
    return await finishRun(store, {
      ...base, responseText: r.text, usage: r.usage,
      ...(truncated ? { warnings: ['AI 응답이 길이 제한으로 잘렸습니다. 파싱된 항목만 반영했습니다.'] } : {}),
    }, deps);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'AI_RUN_CLOSED') return null;
    const message = e instanceof Error ? e.message : String(e);
    // 응답 파싱 실패만 run을 닫는다. 그 외(NOT_FOUND, 권한 등)는 그대로 전파한다.
    if (code !== 'AI_BAD_RESPONSE' && code !== 'AI_RUN_MISMATCH' && code !== 'AI_CLIPBOARD_IS_PROMPT') throw e;
    const aiCode: AiErrorCode = truncated ? 'AI_TRUNCATED' : code;
    return failRun(store, { ...base, error: { code: aiCode, message: truncated ? 'AI 응답이 길이 제한으로 잘려 읽을 수 없습니다.' : message }, responseText: r.text }, deps);
  }
}

/** AI 제안을 값으로 적용한다. 검증 실패·dismissed·stale 제안은 거부한다. */
export async function applySuggestion(
  store: IFileStore, p: { noticeId: string; runId: string; key: ExtractionKey; note?: string }, deps: AiApiDeps,
): Promise<{ notice: Notice; extraction: Extraction; aiReview: AiReviewFile }> {
  const now = deps.now ?? (() => new Date());
  const { notice, extraction } = await loadNoticeAndExtraction(store, p.noticeId);
  const ai = new AiReviewStore(store);
  const run = (await ai.load(notice))?.runs.find((r) => r.id === p.runId);
  if (!run) throw err('NOT_FOUND', '해당 AI 실행을 찾을 수 없습니다.');
  const s = Object.hasOwn(run.suggestions, p.key) ? run.suggestions[p.key] : undefined;
  if (!s || run.status !== 'done' || s.value === null || s.dismissedAt) throw err('AI_SUGGESTION_INVALID', '적용할 수 없는 AI 제안입니다.');
  if (run.extractionJobId !== extraction.jobId) throw err('AI_STALE', '추출 결과가 다시 만들어져 이 제안은 적용할 수 없습니다.');
  const r = await editExtraction(store, { noticeId: p.noticeId, key: p.key, value: s.value, ...(p.note ? { note: p.note } : {}) }, {
    now: deps.now, isBusy: deps.isBusy, expectJobId: run.extractionJobId,
    origin: { kind: 'ai', runId: run.id, provider: run.provider, model: run.model, promptVersion: run.promptVersion },
    source: { ref: `ai:${run.id}`, ...(s.evidence?.evidence ? { evidence: s.evidence.evidence } : {}), ...(s.page != null ? { page: s.page } : {}) },
  });
  const aiReview = await ai.mutate(notice, (f) => {
    const sug = f.runs.find((x) => x.id === run.id)?.suggestions[p.key];
    if (sug) sug.appliedAt = now().toISOString();
  });
  return { notice: r.notice, extraction: r.extraction, aiReview };
}

export async function dismissSuggestion(store: IFileStore, p: { noticeId: string; runId: string; key: ExtractionKey }, deps: AiApiDeps): Promise<AiReviewFile> {
  const now = deps.now ?? (() => new Date());
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  return new AiReviewStore(store).mutate(notice, (f) => {
    const run = f.runs.find((r) => r.id === p.runId);
    const sug = run && Object.hasOwn(run.suggestions, p.key) ? run.suggestions[p.key] : undefined;
    if (!sug) throw err('AI_SUGGESTION_INVALID', '해당 AI 제안을 찾을 수 없습니다.');
    sug.dismissedAt = now().toISOString();
  });
}

export async function getReview(store: IFileStore, noticeId: string): Promise<AiReviewFile | null> {
  const notice = await new NoticeStore(store).loadNotice(noticeId);
  return notice ? new AiReviewStore(store).load(notice) : null;
}

export async function getPrompt(store: IFileStore, p: { noticeId: string; runId: string }): Promise<{ text: string }> {
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  if (!(await new AiReviewStore(store).load(notice))?.runs.some((r) => r.id === p.runId)) throw err('NOT_FOUND', '해당 AI 실행을 찾을 수 없습니다.');
  return { text: await new AiReviewStore(store).readPrompt(notice, p.runId) };
}

export async function listModels(provider: AiProvider, apiKey: string, fetchFn: typeof globalThis.fetch): Promise<{ models: Array<{ id: string; displayName?: string }> }> {
  return { models: await getAdapter(provider).listModels(apiKey, fetchFn) };
}
