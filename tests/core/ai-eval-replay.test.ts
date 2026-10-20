import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAiResponse } from '../../src/core/ai/parse';
import { verifySuggestions } from '../../src/core/ai/verify';
import { EXTRACTION_KEYS, type ExtractionKey } from '../../src/core/types/extraction';
import { EVAL_RUN_ID, RESULTS_DIR, judge, loadAnswerKeys, loadEvalFiles, readText, toVerifyFiles, type Verdict } from '../helpers/ai-eval';

interface ResultFile {
  promptVersion: string;
  runs: Array<{ noticeId: string; responseFile: string; error?: string; items: Partial<Record<ExtractionKey, { verdict: Verdict }>> }>;
}

const REPLAY_OUT = 'replay-latest.json';
const answers = new Map(loadAnswerKeys().map((a) => [a.noticeId, a]));
const resultFiles = existsSync(RESULTS_DIR)
  ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json') && f !== 'coverage-baseline.json' && f !== REPLAY_OUT)
  : [];

/** 현재 parse·verify·정답표 기준 재채점 집계(항목별 verdict 개수). */
const totals: Record<string, Record<string, number>> = {};
const changes: string[] = [];
const tally = (now: Record<string, Verdict>): void => {
  for (const [k, v] of Object.entries(now)) { const t = (totals[k] ??= {}); t[v] = (t[v] ?? 0) + 1; }
};

describe.skipIf(resultFiles.length === 0)('AI 응답 리플레이(parse→verify 회귀)', () => {
  // 재채점 결과는 파일로 남긴다(vitest가 통과 테스트의 콘솔 출력을 숨길 수 있음).
  afterAll(() => { if (Object.keys(totals).length) writeFileSync(`${RESULTS_DIR}/${REPLAY_OUT}`, `${JSON.stringify({ totals, changes }, null, 1)}\n`); });
  for (const rf of resultFiles) {
    const result = JSON.parse(readText(`${RESULTS_DIR}/${rf}`)) as ResultFile;
    for (const run of result.runs) {
      const ans = answers.get(run.noticeId);
      const t = ans && !run.error && existsSync(run.responseFile) ? it : it.skip;
      t(`${rf} / ${run.responseFile}: verdict 재현`, () => {
        const parsed = parseAiResponse(readText(run.responseFile), { runId: EVAL_RUN_ID, keys: EXTRACTION_KEYS });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const v = verifySuggestions(parsed.items, {
          files: toVerifyFiles(loadEvalFiles(ans!)), baseline: {}, requested: EXTRACTION_KEYS, provider: 'gemini', promptVersion: result.promptVersion,
        });
        const now: Record<string, Verdict> = {};
        for (const key of EXTRACTION_KEYS) {
          const a = ans!.items[key];
          if (!a) continue;
          const s = v.suggestions[key];
          now[key] = judge(key, a, { value: s?.value ?? null, note: s?.note, variants: s?.variants, rejectedReason: v.rejected.find((x) => x.key === key)?.reason });
        }
        // 회귀만 실패: 기록 당시 correct였던 항목이 지금 correct가 아니면 실패. 나아진 항목은 출력만 한다.
        const regressed: string[] = [];
        const improved: string[] = [];
        for (const [k, it2] of Object.entries(run.items)) {
          const was = it2!.verdict;
          const is = now[k];
          if (was === 'correct' && is !== 'correct') regressed.push(`${k}: ${was} → ${is}`);
          else if (was !== is) improved.push(`${k}: ${was} → ${is}`);
        }
        for (const c of [...improved, ...regressed]) changes.push(`${run.responseFile} ${c}`);
        tally(now);
        expect(regressed).toEqual([]);
      });
    }
  }
});
