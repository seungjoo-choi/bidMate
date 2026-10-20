/** AI 재검토 화면용 순수 함수. 제안은 run 파일(ai-review.json)에서 읽고, 항목 값은 건드리지 않는다. */
import type { AiRejectReason, AiReviewFile, AiRun, AiSuggestion } from '../../core/types/ai';
import type { Extraction, ExtractionFile, ExtractionKey } from '../../core/types/extraction';
import { EXTRACTION_KEYS } from '../../core/types/extraction';
import { DOC_KIND_LABEL, FILE_STATUS_LABEL, fileDisplayName, type CardBadge } from './view';

export const VERDICT_LABEL: Record<AiSuggestion['verdict'], string> = {
  match: 'AI 확인 일치', differs: 'AI 제안 (현재 값과 다름)', new: 'AI 제안', none: 'AI도 찾지 못함',
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
 * 키별로 가장 최근의 non-stale done run의 제안. 그 제안이 무시(dismissed)됐으면 오래된 run으로 되돌아가지 않고 표시하지 않는다.
 * 그 run이 해당 키의 제안을 담지 않았으면(요청 안 함) 더 오래된 run으로 넘어간다.
 */
export function buildAiCards(review: AiReviewFile | null | undefined, extraction: Pick<Extraction, 'jobId'>): Partial<Record<ExtractionKey, AiCardInfo>> {
  const out: Partial<Record<ExtractionKey, AiCardInfo>> = {};
  const handled = new Set<ExtractionKey>();
  for (const run of review?.runs ?? []) {
    if (run.status !== 'done' || isStale(run, extraction)) continue;
    for (const key of EXTRACTION_KEYS) {
      if (handled.has(key) || !Object.hasOwn(run.suggestions, key)) continue;
      const suggestion = run.suggestions[key];
      if (!suggestion) continue;
      handled.add(key);
      if (!suggestion.dismissedAt) out[key] = { suggestion, run };
    }
  }
  return out;
}

/** 이전 run에서 가져와 표시 중인 제안 수(최신 run과 다른 run의 제안). */
export function olderCardCount(cards: Partial<Record<ExtractionKey, AiCardInfo>>, latest: AiRun | null): number {
  return Object.values(cards).filter((c) => c && c.run.id !== latest?.id).length;
}

export interface RunSummary { match: number; proposals: number; none: number; rejected: number }
/** 요약 줄: 일치 a / 제안(differs+new) b / 못 찾음 c / 검증 실패 d */
export function runSummary(run: AiRun): RunSummary {
  const s: RunSummary = { match: 0, proposals: 0, none: 0, rejected: run.rejected.length };
  for (const sug of Object.values(run.suggestions)) {
    if (!sug) continue;
    if (sug.verdict === 'match') s.match++;
    else if (sug.verdict === 'none') s.none++;
    else s.proposals++;
  }
  return s;
}

export type AiAction = 'apply' | 'confirm' | 'dismiss';
export const ACTION_LABEL: Record<AiAction, string> = { apply: '적용', confirm: '이 값으로 확정', dismiss: '무시' };

/**
 * 제안 카드의 버튼. differs/new → 적용·무시, match인데 항목이 verified가 아님 → 이 값으로 확정(= 적용),
 * verified+match → 없음, none → 무시. 이미 적용했고 지금도 사용자 수정이면 없음.
 */
export function suggestionActions(card: { badge: CardBadge; userEdited: boolean }, s: AiSuggestion): AiAction[] {
  if (s.appliedAt && card.userEdited) return [];
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
  const label = `요청문 복사하고 ${providerLabel} 열기`;
  if (prompt === 'loading') return { label, disabled: true, hint: '요청문을 불러오는 중' };
  if (prompt === 'error') return { label, disabled: true, hint: '요청문을 불러오지 못했습니다. 화면을 새로 고쳐 주세요' };
  return { label, disabled: false };
}

/** 복사 결과에 따른 다음 동작. 복사에 실패하면 탭을 열지 않는다(탭을 먼저 열면 문서 포커스를 잃어 복사가 실패한다). */
export function afterCopy(copied: boolean): { openTab: boolean; message: { tone: 'info' | 'error'; text: string } } {
  return copied
    ? { openTab: true, message: { tone: 'info', text: '요청문을 복사했습니다' } }
    : { openTab: false, message: { tone: 'error', text: '복사 실패, 다시 눌러 주세요' } };
}

/** 진행 상태가 끝난 상태(done/failed/cancelled)면 중복 재조회를 막는 서명, 아니면 null. */
export function terminalSignal(state: { runId: string; status: string; at: string } | null): string | null {
  if (!state || !['done', 'failed', 'cancelled'].includes(state.status)) return null;
  return `${state.runId}:${state.status}:${state.at}`;
}
