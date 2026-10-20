import type { AiRun } from '../types/ai';

export interface AiRunSummary { match: number; proposals: number; none: number; rejected: number; multi?: number /* 조건별 값 제안 수(있을 때만). proposals에는 포함하지 않는다 */ }

/** 요약: 일치 / 제안(differs+new) / 못 찾음 / 검증 실패 / 조건별(multi) */
export function runSummary(run: AiRun): AiRunSummary {
  const s: AiRunSummary = { match: 0, proposals: 0, none: 0, rejected: run.rejected.length };
  for (const sug of Object.values(run.suggestions)) {
    if (!sug) continue;
    if (sug.verdict === 'match') s.match++;
    else if (sug.verdict === 'none') s.none++;
    else if (sug.verdict === 'multi') s.multi = (s.multi ?? 0) + 1;
    else s.proposals++;
  }
  return s;
}
