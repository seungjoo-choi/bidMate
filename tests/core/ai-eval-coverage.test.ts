import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildExcerpt, buildFullText } from '../../src/core/ai/excerpt';
import { normalizeForMatch } from '../../src/core/ai/verify';
import { EXTRACTION_KEYS, type ExtractionKey } from '../../src/core/types/extraction';
import { RESULTS_DIR, SYNONYMS, findEvalFile, loadAnswerKeys, loadEvalFiles, readText, toExcerptInputs } from '../helpers/ai-eval';

interface CoverageRecord { noticeId: string; mode: 'api' | 'manual' | 'api-fulltext'; scope: 'all' | 'single'; key: ExtractionKey; covered: boolean }
const BASELINE = `${RESULTS_DIR}/coverage-baseline.json`;
const MODES: Array<{ mode: CoverageRecord['mode']; maxChars?: number }> = [{ mode: 'api' }, { mode: 'manual', maxChars: 30_000 }, { mode: 'api-fulltext' }];
const idOf = (r: CoverageRecord) => `${r.noticeId}|${r.mode}|${r.scope}|${r.key}`;

const answers = loadAnswerKeys();
const records: CoverageRecord[] = [];

describe.skipIf(answers.length === 0)('AI 발췌 커버리지', () => {
  for (const ans of answers) {
    it(`${ans.noticeId}: 정답 근거 줄이 발췌에 포함되는지 측정`, () => {
      const files = loadEvalFiles(ans);
      const inputs = toExcerptInputs(files);
      for (const { mode, maxChars } of MODES) {
        for (const scope of ['all', 'single'] as const) {
          const groups: ExtractionKey[][] = scope === 'all' ? [EXTRACTION_KEYS] : EXTRACTION_KEYS.map((k) => [k]);
          for (const g of groups) {
            const ex = mode === 'api-fulltext' ? buildFullText({ files: inputs, synonyms: SYNONYMS, keys: g }) : buildExcerpt({ files: inputs, synonyms: SYNONYMS, keys: g, ...(maxChars ? { maxChars } : {}) });
            const hay = ex ? ex.text.split('\n').map(normalizeForMatch).join('') : '';
            // 발췌는 셀 줄을 ' | '로 합치므로 줄마다 정규화해 이어 붙인 문자열에서 포함 검사
            for (const key of g) {
              const item = ans.items[key];
              if (!item) continue;
              const covered = item.evidenceLines.every(({ file, line }) => {
                const f = findEvalFile(files, file);
                const raw = f?.text.split(/\r?\n/)[line - 1];
                if (raw === undefined) return false;
                const n = normalizeForMatch(raw);
                return ex !== null && (n === '' || hay.includes(n));
              });
              records.push({ noticeId: ans.noticeId, mode, scope, key, covered });
            }
          }
        }
      }
      expect(records.length).toBeGreaterThan(0);
    });
  }

  it('기준선 대비 회귀 없음(covered였던 것이 uncovered로 바뀌면 실패)', () => {
    const update = process.env.AI_EVAL_UPDATE_BASELINE === '1';
    if (!existsSync(BASELINE) || update) {
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(BASELINE, JSON.stringify(records, null, 2));
      return;
    }
    const now = new Map(records.map((r) => [idOf(r), r.covered]));
    const base = JSON.parse(readText(BASELINE)) as CoverageRecord[];
    const regressed = base.filter((b) => b.covered && now.get(idOf(b)) === false).map(idOf);
    expect(regressed).toEqual([]);
  });
});
