import { kindOf } from '../../core/model/ids';
import type { IndexEntry } from '../../core/types/index-file';

export type EvalPick = { ok: true } | { ok: false; reason: string };

/** 개찰 기준 시각: 결과 추적의 개찰일 → 공고 일정의 개찰일 → 입찰마감(결과 추적과 같은 대체 규칙) */
export function openingOf(n: IndexEntry): string | undefined {
  return n.result?.openingAt ?? n.schedule?.openingAt ?? n.bidCloseAt;
}

/** 평가점수를 가져올 수 있는 공고인가: 입찰공고 ∧ 개찰 시각이 지남. 협상계약 여부는 보지 않는다(없으면 EVAL_NO_RESULT). */
export function evalFetchable(n: IndexEntry, now: Date): EvalPick {
  if (kindOf(n) !== 'bid') return { ok: false, reason: '입찰공고만 평가점수가 있습니다' };
  const at = openingOf(n);
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t) || t > now.getTime()) return { ok: false, reason: '개찰 전입니다' };
  return { ok: true };
}

/** 일괄 선택 가능 여부. 이미 가져온 공고는 공고 상세나 평가분석에서 다시 가져온다. */
export function selectableForEval(n: IndexEntry, now: Date, have: ReadonlySet<string>): EvalPick {
  const f = evalFetchable(n, now);
  if (!f.ok) return f;
  if (have.has(n.noticeId)) return { ok: false, reason: '이미 가져왔습니다' };
  return { ok: true };
}

export interface EvalBatchItem { noticeId: string; noticeNo: string; round: string }
export interface EvalBatchState {
  running: boolean; total: number; done: number; ok: number;
  current?: string;
  failed: Array<{ noticeId: string; message: string }>;
  /** 나머지를 진행해도 같은 이유로 실패하는 오류로 멈췄을 때 그 문구, 사용자가 멈췄으면 '중단됨' */
  stopped?: string;
}

/** 이 오류가 나면 남은 공고도 모두 실패하므로 바로 멈춘다. */
const STOP_CODES = new Set(['EVAL_NOT_LOGGED_IN', 'NEEDS_FS_PERMISSION']);

/** 한 번에 1건씩 순서대로 가져온다(SW도 FIFO 1개). 실패한 건은 기록하고 다음으로 넘어간다. */
export async function runEvalBatch(items: EvalBatchItem[], deps: {
  collect: (ref: { noticeNo: string; round: string }) => Promise<unknown>;
  errorText: (code: string | undefined, message: string) => string;
  onUpdate: (s: EvalBatchState) => void;
  cancelled: () => boolean;
}): Promise<EvalBatchState> {
  let s: EvalBatchState = { running: true, total: items.length, done: 0, ok: 0, failed: [] };
  const emit = (next: EvalBatchState) => { s = next; deps.onUpdate(s); };
  emit(s);
  for (const it of items) {
    if (deps.cancelled()) { emit({ ...s, stopped: '중단됨' }); break; }
    emit({ ...s, current: it.noticeId });
    try {
      await deps.collect({ noticeNo: it.noticeNo, round: it.round });
      emit({ ...s, done: s.done + 1, ok: s.ok + 1 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const message = deps.errorText(code, e instanceof Error ? e.message : String(e));
      emit({ ...s, done: s.done + 1, failed: [...s.failed, { noticeId: it.noticeId, message }] });
      if (code && STOP_CODES.has(code)) { emit({ ...s, stopped: message }); break; }
    }
  }
  const final: EvalBatchState = { ...s, running: false };
  delete final.current;
  emit(final);
  return final;
}
