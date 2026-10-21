import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_DEFAULT_MODELS } from '../../src/core/ai/constants';
import { buildExcerpt, buildFullText } from '../../src/core/ai/excerpt';
import { parseAiResponse } from '../../src/core/ai/parse';
import { PROMPT_VERSION, buildPrompt } from '../../src/core/ai/prompt';
import { verifySuggestions } from '../../src/core/ai/verify';
import { EXTRACTION_KEYS, type ExtractionKey } from '../../src/core/types/extraction';
import { AI_MAX_TOKENS, callProvider } from '../../src/engine/ai/ai-client';
import { geminiAdapter } from '../../src/engine/ai/providers/gemini';
import { outputSchema } from '../../src/engine/ai/providers/schema';
import {
  EVAL_RUN_ID, RESPONSES_DIR, RESULTS_DIR, SYNONYMS, judge, loadAnswerKeys, loadEvalFiles, toExcerptInputs, toVerifyFiles, type Verdict,
} from '../helpers/ai-eval';

// 실행: GEMINI_API_KEY=... npx vitest run -c vitest.eval.config.ts
const apiKey = process.env.GEMINI_API_KEY;
// manual: 30k 발췌 / fulltext: API 전문 전송(prepareRun과 같이 상한 초과 시 발췌 폴백) / 그 외: API 발췌(100k)
const mode = process.env.AI_EVAL_MODE === 'manual' ? 'manual' : process.env.AI_EVAL_MODE === 'fulltext' ? 'fulltext' : 'api';
const model = process.env.AI_EVAL_MODEL || AI_DEFAULT_MODELS.gemini;
const N = Math.max(1, Number(process.env.AI_EVAL_N) || 1);
const DELAY_MS = Math.max(0, Number(process.env.AI_EVAL_DELAY_MS ?? 20_000));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const answers = loadAnswerKeys();

interface ItemResult { expected: unknown; aiValue: unknown; aiNote: string | null; variants: Array<{ condition?: string; value: unknown }> | null; verdict: Verdict; quote: string; rejectedReason: string | null; ambiguous?: string }
interface RunResult {
  noticeId: string; n: number; responseFile: string; inputTokens: number | null; outputTokens: number | null; ms: number;
  error?: string; items: Partial<Record<ExtractionKey, ItemResult>>;
}

const pad = (x: number) => String(x).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

describe.runIf(!!apiKey && answers.length > 0)('AI 온라인 평가(Gemini)', () => {
  it('공고별 호출 → parse → verify → 정답표 비교', async () => {
    const runs: RunResult[] = [];
    for (const ans of answers) {
      const files = loadEvalFiles(ans);
      const exInput = {
        files: toExcerptInputs(files), synonyms: SYNONYMS, keys: EXTRACTION_KEYS,
        ...(mode === 'manual' ? { maxChars: 30_000 } : {}),
      };
      const ex = (mode === 'fulltext' ? buildFullText(exInput) : null) ?? buildExcerpt(exInput);
      const built = buildPrompt({ runId: EVAL_RUN_ID, keys: EXTRACTION_KEYS, excerpt: ex.text, skippedFiles: [] });
      for (let n = 1; n <= N; n++) {
        if (runs.length > 0 && DELAY_MS > 0) await sleep(DELAY_MS);
        const t0 = Date.now();
        const r = await callProvider(geminiAdapter, { apiKey: apiKey!, model, system: built.system, user: built.user, schema: outputSchema(built.spec), schemaName: 'bidmate_ai_review', maxTokens: AI_MAX_TOKENS }, { fetch: globalThis.fetch });
        const ms = Date.now() - t0;
        const responseFile = `${RESPONSES_DIR}/${ans.noticeId}/${PROMPT_VERSION}-${n}.txt`;
        const run: RunResult = { noticeId: ans.noticeId, n, responseFile, inputTokens: null, outputTokens: null, ms, items: {} };
        runs.push(run);
        if (!r.ok) { run.error = `${r.error.code}: ${r.error.message}`; continue; }
        run.inputTokens = r.usage?.inputTokens ?? null;
        run.outputTokens = r.usage?.outputTokens ?? null;
        mkdirSync(`${RESPONSES_DIR}/${ans.noticeId}`, { recursive: true });
        writeFileSync(responseFile, r.text);

        const parsed = parseAiResponse(r.text, { runId: EVAL_RUN_ID, keys: EXTRACTION_KEYS });
        if (!parsed.ok) { run.error = `${parsed.code}: ${parsed.message}`; continue; }
        const v = verifySuggestions(parsed.items, { files: toVerifyFiles(files), baseline: {}, requested: EXTRACTION_KEYS, provider: 'gemini', promptVersion: PROMPT_VERSION });
        for (const key of EXTRACTION_KEYS) {
          const a = ans.items[key];
          if (!a) continue;
          const s = v.suggestions[key];
          const rej = v.rejected.find((x) => x.key === key);
          const verdict = judge(key, a, { value: s?.value ?? null, note: s?.note, variants: s?.variants, rejectedReason: rej?.reason });
          run.items[key] = {
            expected: a.expected, aiValue: s?.value ?? rej?.value ?? null, aiNote: s?.note ?? null, variants: s?.variants?.map((v) => ({ condition: v.condition, value: v.value })) ?? null, verdict,
            quote: s?.quote ?? rej?.quote ?? '', rejectedReason: rej?.reason ?? null, ...(a.ambiguous ? { ambiguous: a.ambiguous } : {}),
          };
        }
      }
    }

    // 항목별 정답률(ambiguous·skipped 제외). partial은 0.5로 세지 않고 별도 집계.
    const accuracy: Record<string, { correct: number; partial: number; wrong: number; rejected: number; total: number; rate: number }> = {};
    for (const key of EXTRACTION_KEYS) {
      const acc = { correct: 0, partial: 0, wrong: 0, rejected: 0, total: 0, rate: 0 };
      for (const run of runs) {
        const it = run.items[key];
        if (!it || it.verdict === 'skipped') continue;
        acc[it.verdict]++; acc.total++;
      }
      acc.rate = acc.total ? acc.correct / acc.total : 0;
      accuracy[key] = acc;
    }
    const tokens = { input: runs.reduce((s, r) => s + (r.inputTokens ?? 0), 0), output: runs.reduce((s, r) => s + (r.outputTokens ?? 0), 0), ms: runs.reduce((s, r) => s + r.ms, 0) };

    mkdirSync(RESULTS_DIR, { recursive: true });
    const resultFile = `${RESULTS_DIR}/${PROMPT_VERSION}-${model}-${stamp(new Date())}.json`;
    writeFileSync(resultFile, JSON.stringify({ promptVersion: PROMPT_VERSION, model, mode, n: N, runs, accuracy, tokens }, null, 2));

    const rows = runs.flatMap((r) => EXTRACTION_KEYS.filter((k) => r.items[k]).map((k) => {
      const it = r.items[k]!;
      return { notice: `${r.noticeId}#${r.n}`, key: k, expected: JSON.stringify(it.expected), ai: JSON.stringify(it.aiValue), verdict: it.ambiguous ? `${it.verdict}(모호)` : it.verdict };
    }));
    console.table(rows);
    console.table(accuracy);
    console.log(`결과: ${resultFile}`, runs.filter((r) => r.error).map((r) => `${r.noticeId}#${r.n} 오류 ${r.error}`));
    expect(runs.length).toBeGreaterThan(0);
  }, Math.max(30 * 60_000, answers.length * N * (DELAY_MS + 60_000)));
});
