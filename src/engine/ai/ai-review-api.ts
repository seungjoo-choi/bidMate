import { outputSchema } from './providers/schema';
import { buildExcerpt, buildFullText, type ExcerptFileInput } from '../../core/ai/excerpt';
import { EXCERPT_MAX_CHARS } from '../../core/ai/constants';
import { parseAiResponse } from '../../core/ai/parse';
import { buildPrompt, PROMPT_VERSION, type BuiltPrompt } from '../../core/ai/prompt';
import { AI_KEYS, isAiKey, isDocAiKey, type AiKey } from '../../core/ai/keys';
import { verifySuggestions, type VerifyFile } from '../../core/ai/verify';
import { pendingLeafKeys } from '../../core/extraction/review-rows';
import { getField } from '../../core/model/notice-fields';
import { normalizePath } from '../../core/model/path';
import { DETAIL_ATTACHMENT_ID, DETAIL_EXCERPT_MAX_CHARS, DETAIL_KIND_LABEL, DETAIL_TEXT_NAME } from '../../core/model/detail-text';
import type { AiErrorCode, AiMode, AiProvider, AiReviewFile, AiRun, AiScope } from '../../core/types/ai';
import { type Extraction, type ExtractionFile } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import type { DocKind } from '../../core/extraction/classify';
import type { IFileStore } from '../file-store/types';
import { editExtraction, editNoticeField } from '../notices/notice-api';
import { PROVIDERS } from './providers';
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
export interface PrepareInput { noticeId: string; scope: AiScope; /** scope가 'keys'일 때 대상 항목 */ keys?: AiKey[]; provider: AiProvider; mode: AiMode; model: string | null; /** API 모드에서 문서 전문 전송 여부(기본 true). manual은 무시 */ sendFullText?: boolean; /** 사용할 파일의 textPath 목록. 없으면 분석된 전체 */ files?: string[]; /** 비교 실행 id */ compareId?: string }
export interface PreparedRun {
  notice: Notice; run: AiRun; built: BuiltPrompt; adapter: AiProviderAdapter;
  /** fullText: 전문을 보냈는가(실패 시 발췌 재시도 판단용) */
  stats: { chars: number; files: number; truncated: boolean; excludedFiles: string[]; fullText: boolean };
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

/** 요청 범위를 대상 키와 저장할 scope로 푼다. auto·keys는 요청 전용이라 저장 scope는 pending | all | keys. */
function resolveKeys(p: Pick<PrepareInput, 'scope' | 'keys'>, notice: Notice, extraction: Extraction): { keys: AiKey[]; scope: AiScope } {
  const none = () => err('NOTHING_TO_REVIEW', '확인이 필요한 항목이 없습니다.');
  if (p.scope === 'all') return { keys: [...AI_KEYS], scope: 'all' };
  if (p.scope === 'pending') {
    const keys = pendingLeafKeys(notice, extraction);
    if (keys.length === 0) throw none();
    return { keys, scope: 'pending' };
  }
  if (p.scope === 'auto') {
    const keys = pendingLeafKeys(notice, extraction);
    return keys.length > 0 ? { keys, scope: 'pending' } : { keys: [...AI_KEYS], scope: 'all' };
  }
  if (p.scope === 'keys') {
    const req = Array.isArray(p.keys) ? p.keys : [];
    if (req.length === 0) throw none();
    if (req.some((k) => !isAiKey(k))) throw err('AI_BAD_REQUEST', '알 수 없는 항목입니다.');
    return { keys: AI_KEYS.filter((k) => req.includes(k)), scope: 'keys' };
  }
  throw err('AI_BAD_REQUEST', '알 수 없는 범위입니다.');
}

/** run 준비: 대상 키 계산 → 발췌 → 프롬프트 txt와 run 저장. 같은 공고의 awaiting run은 cancelled로 바꾼다. */
export async function prepareRun(store: IFileStore, p: PrepareInput, deps: AiApiDeps): Promise<PreparedRun> {
  const adapter = getAdapter(p.provider);
  const now = deps.now ?? (() => new Date());
  const { notice, extraction } = await loadNoticeAndExtraction(store, p.noticeId);
  if (deps.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');

  const { keys, scope: savedScope } = resolveKeys(p, notice, extraction);

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
  // 상세화면 전문: 가상 첨부(priority 0, 맨 앞). 해제는 files 파라미터로(textPath가 없으면 unselected).
  if (notice.detailText) {
    const { textPath } = notice.detailText;
    if (p.files && !p.files.includes(textPath)) skipped.push({ name: DETAIL_TEXT_NAME, reason: 'unselected' });
    else {
      const text = await readFileText(store, notice, textPath);
      if (text === null) skipped.push({ name: DETAIL_TEXT_NAME, reason: 'failed' });
      else inputs.unshift({ attachmentId: DETAIL_ATTACHMENT_ID, sourceFile: DETAIL_TEXT_NAME, name: DETAIL_TEXT_NAME, kindLabel: DETAIL_KIND_LABEL, priority: 0, maxChars: DETAIL_EXCERPT_MAX_CHARS, text });
    }
  }
  if (inputs.length === 0) throw err('NO_DOCUMENTS', '읽을 수 있는 문서가 없습니다.');

  const excerptInput = {
    files: inputs, synonyms: deps.rules.synonyms, keys,
    maxChars: p.mode === 'manual' ? Math.min(EXCERPT_MAX_CHARS, adapter.manualMaxChars) : EXCERPT_MAX_CHARS,
  };
  // API 모드 + 전문 전송 설정이면 전문, 상한 초과(null)면 발췌로 폴백한다. manual은 항상 발췌(붙여넣기 상한).
  let excerpt = p.mode === 'api' && p.sendFullText !== false ? buildFullText(excerptInput) : null;
  const fullText = excerpt !== null;
  if (excerpt === null) {
    excerpt = buildExcerpt(excerptInput);
    if (p.mode === 'api' && p.sendFullText !== false) excerpt = { ...excerpt, warnings: ['전문 상한 초과로 발췌 전송', ...excerpt.warnings] };
  }
  const runId = (deps.newId ?? (() => crypto.randomUUID()))();
  const excludedFiles = skipped.filter((s) => UNREADABLE.includes(s.reason)).map((s) => s.name);
  const built = buildPrompt({ runId, keys, excerpt: excerpt.text, skippedFiles: excludedFiles });
  const nowIso = now().toISOString();
  const run: AiRun = {
    id: runId, createdAt: nowIso, provider: p.provider, mode: p.mode, model: p.mode === 'manual' ? null : p.model,
    promptVersion: PROMPT_VERSION, scope: savedScope, keys,
    extractionJobId: extraction.jobId, extractedAt: extraction.extractedAt,
    status: p.mode === 'manual' ? 'awaiting' : 'requesting',
    files: excerpt.files, skipped, excerptChars: excerpt.chars, truncated: excerpt.truncated,
    warnings: [...excerpt.warnings], suggestions: {}, rejected: [],
    promptPath: aiPromptPath(notice.folder, runId),
    ...(p.compareId ? { compareId: p.compareId } : {}),
  };
  const ai = new AiReviewStore(store);
  await ai.writePrompt(notice, runId, p.mode === 'manual' ? built.manualText : `${built.system}\n\n${built.user}`);
  await ai.mutate(notice, (f) => {
    f.runs = f.runs.map((r) => (r.status === 'awaiting' ? { ...r, status: 'cancelled' as const, finishedAt: nowIso } : r));
    f.runs.unshift(run);
  });
  return { notice, run, built, adapter, stats: { chars: excerpt.chars, files: excerpt.files.length, truncated: excerpt.truncated, excludedFiles, fullText } };
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
    if (rf.attachmentId === DETAIL_ATTACHMENT_ID) {
      const tp = notice.detailText?.textPath;
      const text = tp ? await readFileText(store, notice, tp) : null;
      if (text !== null) files.push({ attachmentId: DETAIL_ATTACHMENT_ID, sourceFile: rf.sourceFile, name: rf.name, docKind: 'notice', text });
      continue;
    }
    const ef = extraction.files.find((f) => f.attachmentId === rf.attachmentId && sourceFileOf(f) === rf.sourceFile && f.textPath);
    if (!ef?.textPath) continue;
    const text = await readFileText(store, notice, ef.textPath);
    if (text !== null) files.push({ attachmentId: ef.attachmentId, sourceFile: rf.sourceFile, name: rf.name, docKind: ef.docKind, text });
  }
  const baseline: Partial<Record<AiKey, unknown>> = {};
  const candidates: Partial<Record<AiKey, unknown[]>> = {};
  const present = (v: unknown) => v !== null && v !== undefined;
  for (const k of run.keys) {
    if (isDocAiKey(k)) {
      const it = extraction.items[k];
      baseline[k] = it.userEdited ? it.userEdited.value : it.value;
      candidates[k] = [...(present(it.value) ? [it.value] : []), ...(it.candidates ?? []).map((c) => c.value)];
    } else {
      const f = getField(notice, k);
      baseline[k] = f?.value ?? null;
      candidates[k] = [...(present(f?.value) ? [f!.value] : []), ...(f?.candidates ?? []).map((c) => c.value)];
    }
  }
  const v = verifySuggestions(parsed.items, { files, baseline, candidates, requested: run.keys, provider: run.provider, promptVersion: run.promptVersion });

  const warnings = [...run.warnings, ...(p.warnings ?? []), ...v.warnings];
  if (extraction.jobId !== run.extractionJobId) warnings.push('AI가 실행되는 동안 다시 수집되어 이 제안은 현재 수집 결과와 맞지 않을 수 있습니다.');
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
    { apiKey: x.apiKey, model: x.model, system: prepared.built.system, user: prepared.built.user, schema: outputSchema(prepared.built.spec), schemaName: 'bidmate_ai_review', maxTokens: AI_MAX_TOKENS },
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
  store: IFileStore, p: { noticeId: string; runId: string; key: AiKey; note?: string; variantIndex?: number }, deps: AiApiDeps,
): Promise<{ notice: Notice; extraction: Extraction; aiReview: AiReviewFile }> {
  const now = deps.now ?? (() => new Date());
  const { notice, extraction } = await loadNoticeAndExtraction(store, p.noticeId);
  const ai = new AiReviewStore(store);
  const run = (await ai.load(notice))?.runs.find((r) => r.id === p.runId);
  if (!run) throw err('NOT_FOUND', '해당 AI 실행을 찾을 수 없습니다.');
  const s = Object.hasOwn(run.suggestions, p.key) ? run.suggestions[p.key] : undefined;
  const variant = p.variantIndex === undefined ? undefined : s?.variants?.[p.variantIndex];
  if (p.variantIndex !== undefined && !variant) throw err('AI_SUGGESTION_INVALID', '적용할 수 없는 AI 제안입니다.');
  const value = variant ? variant.value : s?.value;
  if (!s || run.status !== 'done' || value === null || value === undefined || s.dismissedAt) throw err('AI_SUGGESTION_INVALID', '적용할 수 없는 AI 제안입니다.');
  // 조건은 AI가 준 문자열이라 길이를 잘라 붙이고(빈 값은 UI와 같은 "조건 N"), note 상한 500자를 넘지 않게 한다.
  const cond = variant ? (variant.condition.trim().slice(0, 60) || `조건 ${p.variantIndex! + 1}`) : '';
  const note = variant ? `[${cond}] ${p.note ?? ''}`.trim().slice(0, 500) : p.note;
  if (run.extractionJobId !== extraction.jobId) throw err('AI_STALE', '추출 결과가 다시 만들어져 이 제안은 적용할 수 없습니다.');
  const picked = variant ?? s;
  const source = {
    ref: `ai:${run.id}`,
    ...(picked.evidence?.evidence ? { evidence: picked.evidence.evidence } : {}),
    ...(picked.page != null ? { page: picked.page } : {}),
  };
  let r: { notice: Notice; extraction: Extraction };
  if (isDocAiKey(p.key)) {
    r = await editExtraction(store, { noticeId: p.noticeId, key: p.key, value, ...(note ? { note } : {}) }, {
      now: deps.now, isBusy: deps.isBusy, expectJobId: run.extractionJobId,
      origin: { kind: 'ai', runId: run.id, provider: run.provider, model: run.model, promptVersion: run.promptVersion },
      source,
    });
  } else {
    // 공고 잎: extraction.items는 건드리지 않고 notice 필드만 user_edited로 바꾼다. AI 적용 표시는 source.ref(ai:)로 파생.
    const defNote = `AI 제안 적용(${PROVIDERS[run.provider]?.label ?? run.provider}${run.model ? ` ${run.model}` : ''})`;
    const rawText = picked.raw;
    const e = await editNoticeField(store, { noticeId: p.noticeId, key: p.key, value, note: note || defNote, ...(rawText ? { raw: rawText } : {}) }, {
      now: deps.now, isBusy: deps.isBusy, source,
    });
    r = { notice: e.notice, extraction: e.extraction ?? extraction };
  }
  const aiReview = await ai.mutate(notice, (f) => {
    const sug = f.runs.find((x) => x.id === run.id)?.suggestions[p.key];
    if (sug) sug.appliedAt = now().toISOString();
  });
  return { notice: r.notice, extraction: r.extraction, aiReview };
}

export async function dismissSuggestion(store: IFileStore, p: { noticeId: string; runId: string; key: AiKey }, deps: AiApiDeps): Promise<AiReviewFile> {
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
