/** AI 재검토 화면용 순수 함수. 제안은 run 파일(ai-review.json)에서 읽고, 항목 값은 건드리지 않는다. */
import type { AiMode, AiProvider, AiRejectReason, AiReviewFile, AiRun, AiScope, AiSuggestion } from '../../core/types/ai';
import type { Extraction, ExtractionFile, ExtractionKey } from '../../core/types/extraction';
import { EXTRACTION_KEYS } from '../../core/types/extraction';
import { runSummary, type AiRunSummary } from '../../core/ai/summary';
import type { AiRunState } from '../../core/types/ai';
import { DOC_KIND_LABEL, FILE_STATUS_LABEL, ITEM_LABEL, fileDisplayName, type CardBadge } from './view';

export { runSummary, type AiRunSummary };
/** 기존 이름(호환) */
export type RunSummary = AiRunSummary;

export const VERDICT_LABEL: Record<AiSuggestion['verdict'], string> = {
  match: 'AI 확인 일치', differs: 'AI 제안 (현재 값과 다름)', new: 'AI 제안', none: 'AI도 찾지 못함', multi: '조건별로 다름',
};
export const REJECT_LABEL: Record<AiRejectReason, string> = {
  quote_missing: '근거 문장 없음',
  quote_too_short: '근거 문장이 너무 짧음',
  quote_not_found: '근거 문장을 원문에서 찾지 못함',
  bad_format: '값 형식이 올바르지 않음',
  unknown_key: '요청하지 않은 항목',
  file_not_found: '파일을 찾지 못함',
};

/** 이 run이 본 추출 결과가 현재와 다르면 stale. */
export const isStale = (run: AiRun, extraction: Pick<Extraction, 'jobId'>): boolean => run.extractionJobId !== extraction.jobId;

/** 가장 최근 run(파일은 최신 먼저). */
export const latestRun = (review: AiReviewFile | null | undefined): AiRun | null => review?.runs[0] ?? null;

export interface AiCardInfo { suggestion: AiSuggestion; run: AiRun }

/**
 * 키별로 가장 최근에 그 키를 "요청한" non-stale done run의 제안(run.keys 기준). 그 run에 제안이 없으면(검증 실패 등) 오래된 run으로
 * 되돌아가지 않고 빈칸, 무시(dismissed)됐어도 마찬가지. 요청하지 않은 run은 건너뛴다.
 * keys가 빈 옛 run은 제안이 있는 키를 요청한 것으로 본다(방어).
 */
export function buildAiCards(review: AiReviewFile | null | undefined, extraction: Pick<Extraction, 'jobId'>): Partial<Record<ExtractionKey, AiCardInfo>> {
  const out: Partial<Record<ExtractionKey, AiCardInfo>> = {};
  const handled = new Set<ExtractionKey>();
  for (const run of review?.runs ?? []) {
    if (run.status !== 'done' || isStale(run, extraction)) continue;
    for (const key of EXTRACTION_KEYS) {
      if (handled.has(key)) continue;
      const has = Object.hasOwn(run.suggestions, key);
      const requested = run.keys.length > 0 ? run.keys.includes(key) : has;
      if (!requested) continue;
      handled.add(key);
      const suggestion = has ? run.suggestions[key] : undefined;
      if (suggestion && !suggestion.dismissedAt) out[key] = { suggestion, run };
    }
  }
  return out;
}

/** 이전 run에서 가져와 표시 중인 제안 수(최신 run과 다른 run의 제안). */
export function olderCardCount(cards: Partial<Record<ExtractionKey, AiCardInfo>>, latest: AiRun | null): number {
  return Object.values(cards).filter((c) => c && c.run.id !== latest?.id).length;
}


export type AiAction = 'apply' | 'confirm' | 'dismiss';
export const ACTION_LABEL: Record<AiAction, string> = { apply: '적용', confirm: '이 값으로 확정', dismiss: '무시' };

/**
 * 제안 카드의 버튼. differs/new → 적용·무시, match인데 항목이 verified가 아님 → 이 값으로 확정(= 적용),
 * verified+match → 없음, none → 무시, multi(variants 있음) → 적용·무시(적용은 variant 단위). 이미 적용했고 지금도 사용자 수정이면 없음.
 */
export function suggestionActions(card: { badge: CardBadge; userEdited: boolean }, s: AiSuggestion): AiAction[] {
  if (s.appliedAt && card.userEdited) return [];
  if (s.verdict === 'multi' && s.variants?.length) return ['apply', 'dismiss']; // 값은 variant마다 고른다
  if (s.verdict === 'none' || s.value === null) return ['dismiss'];
  if (s.verdict === 'match') return card.badge === 'verified' ? [] : ['confirm'];
  return ['apply', 'dismiss'];
}

export interface ChecklistRow { textPath?: string; name: string; kindLabel: string; selectable: boolean; remark?: string }
const EXCLUDED_STATUS = new Set(['scanned', 'encrypted', 'drm', 'unsupported', 'failed', 'corrupt', 'timeout']);

/** 파일 체크리스트: 분석 완료(+텍스트)는 선택 가능, 스캔·암호 등은 회색 고정(AI 재검토 제외). 의도적으로 건너뛴 파일(양식·중복 등)은 보이지 않는다. */
export function fileChecklist(files: ExtractionFile[]): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  for (const f of files) {
    const base = { name: fileDisplayName(f), kindLabel: DOC_KIND_LABEL[f.docKind] ?? f.docKind };
    if (f.status === 'parsed' && f.textPath) rows.push({ ...base, textPath: f.textPath, selectable: true });
    else if (EXCLUDED_STATUS.has(f.status)) rows.push({ ...base, selectable: false, remark: `AI 재검토 제외 (${FILE_STATUS_LABEL[f.status] ?? f.status})` });
  }
  return rows;
}

/** 선택한 파일의 글자 수 합(분석 때 센 값). 반자동 상한 경고에 쓴다. */
export function selectedChars(files: ExtractionFile[], selected: ReadonlySet<string>): number {
  return files.reduce((n, f) => n + (f.textPath && selected.has(f.textPath) ? f.chars ?? 0 : 0), 0);
}

/** 전부 선택했으면 undefined(서버 기본), 일부면 textPath 배열. */
export function filesParam(rows: ChecklistRow[], selected: ReadonlySet<string>): string[] | undefined {
  const all = rows.filter((r) => r.selectable).map((r) => r.textPath!);
  const picked = all.filter((p) => selected.has(p));
  return picked.length === all.length ? undefined : picked;
}

/** 쿼터·속도 제한 오류면 다시 시도/다른 공급자 안내를 붙인다. */
export const isLimitError = (code: string | undefined): boolean => code === 'AI_QUOTA' || code === 'AI_RATE_LIMIT';
/** 설정을 고치면 풀리는 오류 */
export const isSetupError = (code: string | undefined): boolean => code === 'AI_KEY_MISSING' || code === 'AI_MODEL_MISSING' || code === 'AI_PERMISSION_MISSING';

export type PromptLoad = 'loading' | 'ready' | 'error';
/** 대기 패널의 주 버튼: 요청문을 미리 받아 둔 뒤에만 눌러 복사하고 탭을 연다(클릭 안에서 await 없이 바로 복사하기 위해). */
export function copyOpenButton(prompt: PromptLoad, providerLabel: string): { label: string; disabled: boolean; hint?: string } {
  const label = `프롬프트 복사하고 ${providerLabel} 열기`;
  if (prompt === 'loading') return { label, disabled: true, hint: '프롬프트를 불러오는 중' };
  if (prompt === 'error') return { label, disabled: true, hint: '프롬프트를 불러오지 못했습니다. 화면을 새로 고쳐 주세요' };
  return { label, disabled: false };
}

/** 복사 결과에 따른 다음 동작. 복사에 실패하면 탭을 열지 않는다(탭을 먼저 열면 문서 포커스를 잃어 복사가 실패한다). */
export function afterCopy(copied: boolean): { openTab: boolean; message: { tone: 'info' | 'error'; text: string } } {
  return copied
    ? { openTab: true, message: { tone: 'info', text: '프롬프트를 복사했습니다' } }
    : { openTab: false, message: { tone: 'error', text: '복사 실패, 다시 눌러 주세요' } };
}

/** 진행 상태가 끝난 상태(done/failed/cancelled)면 중복 재조회를 막는 서명, 아니면 null. */
export function terminalSignal(state: { runId: string; status: string; at: string } | null): string | null {
  if (!state || !['done', 'failed', 'cancelled'].includes(state.status)) return null;
  return `${state.runId}:${state.status}:${state.at}`;
}

/** run의 범위 표시: "확인 필요 항목" / "7개 전체" / "항목: …" */
export function scopeLabel(run: Pick<AiRun, 'scope' | 'keys'>): string {
  if (run.scope === 'pending') return '확인 필요 항목';
  if (run.scope === 'all') return '7개 전체';
  if (run.scope === 'keys' || (run.keys.length > 0 && run.keys.length < EXTRACTION_KEYS.length)) return `항목: ${run.keys.map((k) => ITEM_LABEL[k] ?? k).join(', ')}`;
  return '7개 전체';
}

export interface QuickView {
  phase: 'idle' | 'running' | 'awaiting' | 'done' | 'failed';
  label: string;
  summary?: AiRunSummary;
  error?: { code: string; message: string };
}
/** 사이드패널·확인 탭이 공유하는 AI 상태 한 줄. 최신 run이 기준이며, stale done·cancelled·run 없음은 idle. */
export function quickView(review: AiReviewFile | null | undefined, extraction: Pick<Extraction, 'jobId'> | null | undefined, state: AiRunState | null): QuickView {
  const run = latestRun(review);
  // run 파일이 아직 없거나(준비 단계) 최신 run이 이전 run인 동안은 세션 진행 상태를 우선한다
  if (state && ['preparing', 'requesting', 'verifying'].includes(state.status) && (!run || (state.runId !== run.id && run.status !== 'requesting'))) {
    return { phase: 'running', label: state.label || '준비 중' };
  }
  if (!run) return { phase: 'idle', label: '' };
  if (run.status === 'requesting') return { phase: 'running', label: state?.runId === run.id ? state.label : 'AI에 요청하는 중' };
  if (run.status === 'awaiting') return { phase: 'awaiting', label: 'AI 답변 붙여넣기 대기 중' };
  if (run.status === 'failed') return { phase: 'failed', label: 'AI 재검토 실패', error: run.error ?? { code: 'AI_HTTP', message: '' } };
  if (run.status === 'done' && extraction && !isStale(run, extraction)) {
    const s = runSummary(run);
    return { phase: 'done', label: `AI 제안 ${s.proposals}${s.multi ? ` · 조건별 ${s.multi}개` : ''} · 일치 ${s.match} · 못 찾음 ${s.none} · 검증 실패 ${s.rejected}`, summary: s };
  }
  return { phase: 'idle', label: '' };
}

/** API 방식인데 키·모델이 없으면 실행 전에 알려 줄 설정 오류. manual이거나 키 상태를 아직 못 읽었으면 null. */
export function aiSetupBlock(
  ai: { provider: AiProvider; mode: AiMode; models: Partial<Record<AiProvider, string>> },
  keys: Record<AiProvider, boolean> | null,
): { code: 'AI_KEY_MISSING' | 'AI_MODEL_MISSING'; message: string } | null {
  if (ai.mode !== 'api' || !keys) return null;
  if (!keys[ai.provider]) return { code: 'AI_KEY_MISSING', message: 'API 키가 없습니다' };
  if (!ai.models[ai.provider]?.trim()) return { code: 'AI_MODEL_MISSING', message: '모델이 설정되지 않았습니다' };
  return null;
}

/** 요청 범위가 실제로 가리킬 키(UI가 "찾는 중" 표시를 미리 하는 데 쓴다). auto는 확인 필요가 있으면 그것만, 없으면 전체. */
export function scopeKeys(scope: AiScope, keys: ExtractionKey[] | undefined, pending: ExtractionKey[]): ExtractionKey[] {
  if (scope === 'keys') return keys ?? [];
  if (scope === 'pending') return pending;
  if (scope === 'auto') return pending.length > 0 ? pending : [...EXTRACTION_KEYS];
  return [...EXTRACTION_KEYS];
}

/** 실행 요청 오류의 사용자 문구. */
export function aiErrorText(code: string | undefined, message: string): string {
  if (code === 'NOTHING_TO_REVIEW') return '확인이 필요한 항목이 없습니다. 7개 항목 전체로 실행하세요.';
  if (code === 'JOB_ALREADY_RUNNING') return '이 공고는 다른 작업이 진행 중입니다';
  if (code === 'AI_RUN_BUSY') return '이 공고는 이미 AI 실행 중입니다';
  return `${code ?? ''} ${message}`.trim();
}

/** 지금 요청 중인 run이 이 키를 찾고 있는가. */
export function isFindingKey(run: Pick<AiRun, 'status' | 'keys'> | null, key: ExtractionKey): boolean {
  return run?.status === 'requesting' && run.keys.includes(key);
}
