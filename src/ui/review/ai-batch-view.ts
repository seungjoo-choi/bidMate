/** 공고 목록 일괄 실행 화면용 순수 함수. 상태(AiBatchState)에는 제목이 없어 UI가 noticeId로 붙인다. */
import { kindOf } from '../../core/model/ids';
import type { AiBatchItem, AiBatchState } from '../../core/types/ai';
import type { IndexEntry } from '../../core/types/index-file';

export const batchActive = (s: AiBatchState | null | undefined): boolean => s?.status === 'running' || s?.status === 'waiting';

/** AI 일괄 대상: 입찰공고(사전규격 아님) ∧ 평가정보가 분석됨(verified · needs_review). 불가면 사유(툴팁)를 돌려준다. */
export function selectableForAi(entry: Pick<IndexEntry, 'extractionStatus' | 'kind' | 'noticeId'>): { ok: true } | { ok: false; reason: string } {
  if (kindOf(entry) === 'prespec') return { ok: false, reason: '사전규격은 AI 재검토 대상이 아닙니다' };
  const st = entry.extractionStatus ?? 'not_run';
  if (st === 'verified' || st === 'needs_review') return { ok: true };
  return { ok: false, reason: st === 'failed' ? '추출 실패' : st === 'unsupported' ? '분석 불가' : '평가정보 미분석' };
}

export interface HeaderToggle { checked: boolean; indeterminate: boolean; next: Set<string> }
/** 헤더 체크박스: 보이는 행 중 선택 가능한 것 전체를 토글한다. 다른(안 보이는) 선택은 건드리지 않는다. */
export function headerToggle(selectableVisible: string[], selected: ReadonlySet<string>): HeaderToggle {
  const picked = selectableVisible.filter((id) => selected.has(id)).length;
  const all = selectableVisible.length > 0 && picked === selectableVisible.length;
  const next = new Set(selected);
  if (all) selectableVisible.forEach((id) => next.delete(id)); else selectableVisible.forEach((id) => next.add(id));
  return { checked: all, indeterminate: picked > 0 && !all, next };
}

export const ITEM_REASON_LABEL: Record<string, string> = {
  JOB_ALREADY_RUNNING: '수집 중',
  AI_RUN_BUSY: 'AI 실행·대기 중',
  AI_ALREADY_RAN: '배치 중 직접 실행됨',
  NOT_FOUND: '추출 결과 없음',
  NO_DOCUMENTS: '읽을 문서 없음',
  AI_BATCH_STOPPED: '중단으로 미실행',
  AI_BATCH_CANCELLED: '취소',
};
/** 건너뜀·실패 사유 한 줄. 모르는 코드는 code와 message. */
export function itemReasonLabel(item: Pick<AiBatchItem, 'error'>): string {
  const e = item.error;
  if (!e) return '';
  return ITEM_REASON_LABEL[e.code] ?? `${e.code}${e.message ? ` ${e.message}` : ''}`;
}

export type ResultTone = 'ok' | 'muted' | 'bad';
/** 공고별 결과 한 줄과 색조. 완료는 "제안 a · 일치 b"(못 찾음·검증 실패는 있을 때만), 건너뜀은 "건너뜀 · 사유", 실패는 사유. */
export function itemResult(item: AiBatchItem): { text: string; tone: ResultTone } {
  switch (item.status) {
    case 'done': {
      const s = item.summary;
      const parts = [`제안 ${s?.proposals ?? 0}`, `일치 ${s?.match ?? 0}`];
      if (s?.multi) parts.push(`조건별 ${s.multi}개`);
      if (s?.none) parts.push(`못 찾음 ${s.none}`);
      if (s?.rejected) parts.push(`검증 실패 ${s.rejected}`);
      return { text: parts.join(' · '), tone: 'ok' };
    }
    case 'skipped': return { text: `건너뜀 · ${itemReasonLabel(item)}`, tone: 'muted' };
    case 'failed': return { text: itemReasonLabel(item) || '실패', tone: 'bad' };
    case 'running': return { text: '진행 중', tone: 'muted' };
    default: return { text: '대기', tone: 'muted' };
  }
}

export interface BatchCounts { done: number; failed: number; skipped: number; running: number; queued: number; total: number }
export function batchCounts(s: Pick<AiBatchState, 'items'>): BatchCounts {
  const c: BatchCounts = { done: 0, failed: 0, skipped: 0, running: 0, queued: 0, total: s.items.length };
  for (const it of s.items) c[it.status]++;
  return c;
}

/** 진행 위치 i / n: 끝난 항목(완료·실패·건너뜀) + 진행 중 1건. */
export function progressIndex(s: Pick<AiBatchState, 'items'>): number {
  const c = batchCounts(s);
  return Math.min(c.total, c.done + c.failed + c.skipped + (c.running > 0 ? 1 : 0));
}

export type BarCell = 'done' | 'fail' | 'skip' | 'run' | 'queued';
/** 칸 막대(공고 1건 = 1칸). 재시도를 기다리는 중(waiting)인 현재 공고는 진행 중으로 본다. */
export function barCells(s: Pick<AiBatchState, 'items' | 'status' | 'currentIndex'>): BarCell[] {
  return s.items.map((it, i) => {
    if (s.status === 'waiting' && i === s.currentIndex) return 'run';
    return it.status === 'done' ? 'done' : it.status === 'failed' ? 'fail' : it.status === 'skipped' ? 'skip' : it.status === 'running' ? 'run' : 'queued';
  });
}

/** 현재 진행 중인 공고 id(없으면 undefined). */
export function currentNoticeId(s: Pick<AiBatchState, 'items' | 'currentIndex' | 'status'>): string | undefined {
  if (!batchActive(s as AiBatchState)) return undefined;
  return s.items[s.currentIndex ?? -1]?.noticeId ?? s.items.find((it) => it.status === 'running')?.noticeId;
}

/** waiting일 때 남은 초(올림). 아니면 0. */
export function waitSeconds(s: Pick<AiBatchState, 'status' | 'waitUntil'>, nowMs: number): number {
  if (s.status !== 'waiting' || !s.waitUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(s.waitUntil) - nowMs) / 1000));
}

/** 종료 상태의 머리 문구. */
export function finishText(s: Pick<AiBatchState, 'status' | 'items' | 'stopReason'>): string {
  const c = batchCounts(s);
  const tail = `완료 ${c.done} · 실패 ${c.failed} · 건너뜀 ${c.skipped}`;
  if (s.status === 'cancelled') return `취소됨 · ${tail}`;
  if (s.status === 'stopped') return `중단됨 · ${tail}`;
  return `완료 · ${tail}`;
}

/** [남은 공고 다시 실행] 대상: 중단으로 건너뛴(AI_BATCH_STOPPED) 항목과 아직 대기 중인 항목. */
export function retryTargets(s: Pick<AiBatchState, 'items'>): string[] {
  return s.items.filter((it) => it.status === 'queued' || (it.status === 'skipped' && it.error?.code === 'AI_BATCH_STOPPED')).map((it) => it.noticeId);
}

/** 중단 사유 안내. */
export function stopReasonText(s: Pick<AiBatchState, 'stopReason'>): string {
  const r = s.stopReason;
  if (!r) return '';
  switch (r.code) {
    case 'AI_QUOTA': return '사용 한도를 넘어 중단했습니다. 다른 공급자로 실행하거나 한도가 풀린 뒤 다시 실행하세요';
    case 'AI_AUTH': return 'API 키가 올바르지 않아 중단했습니다. 설정에서 키를 확인하세요';
    case 'AI_RATE_LIMIT': return '분당 호출 한도가 계속 걸려 중단했습니다. 잠시 후 다시 실행하세요';
    case 'AI_OVERLOADED': return '서비스가 혼잡해 연속 실패하여 중단했습니다. 잠시 후 다시 실행하세요';
    case 'AI_INTERRUPTED': return '실행이 중단되었습니다. 남은 공고를 다시 실행하세요';
    default: return `${r.code} ${r.message}`.trim();
  }
}

/** 일괄 실행을 막는 사유(키·모델 없음, 이미 실행 중). 막지 않으면 null. hasKey가 null이면 아직 읽는 중이라 막는다. */
export function batchBlockReason(o: { hasKey: boolean | null; model: string | undefined; active: boolean; providerLabel?: string }): { text: string; setup: boolean } | null {
  if (o.active) return { text: '일괄 실행이 진행 중입니다', setup: false };
  if (o.hasKey === null) return { text: '설정을 불러오는 중', setup: false };
  const who = o.providerLabel ?? '공급자';
  if (!o.hasKey) return { text: `일괄 실행은 API 방식만 지원합니다. 설정에서 ${who} 키를 저장하세요`, setup: true };
  if (!o.model?.trim()) return { text: `일괄 실행은 API 방식만 지원합니다. 설정에서 ${who} 모델을 선택하세요`, setup: true };
  return null;
}

/** 일괄 실행은 API 전용이다. 설정이 반자동이면 선택 막대에 항상 보이는 안내. */
export function batchModeNote(mode: 'api' | 'manual' | undefined): string | null {
  return mode === 'manual' ? '일괄 실행은 API 방식으로 진행됩니다(설정: 프롬프트 복사)' : null;
}
/** 유료 API(Claude·OpenAI)인데 설정이 반자동이면 실행 전에 한 번 더 확인한다(반자동으로 쓰던 사용자가 비용을 모르고 누르는 것 방지). */
export function needsPaidConfirm(provider: 'claude' | 'openai' | 'gemini', mode: 'api' | 'manual' | undefined): boolean {
  return mode === 'manual' && provider !== 'gemini';
}
export const paidConfirmText = (count: number): string => `유료 API로 ${count}건 실행합니다`;
