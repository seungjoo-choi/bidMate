import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../src/core/search/normalize';
import { buildUnits } from '../../src/core/search/units';
import { searchDoc } from '../../src/core/search/match';
import type { SearchDoc } from '../../src/core/search/types';

const mk = (lines: string[]): SearchDoc => ({ id: 'd', kind: 'detail', label: 'L', kindLabel: 'K', priority: 0, lines });
const run = (lines: string[], raw: string, max?: number) => {
  const doc = mk(lines);
  return searchDoc(doc, buildUnits(lines), parseQuery(raw), max);
};

describe('searchDoc', () => {
  it('AND 의미: 한 항만 있으면 불일치', () => {
    const lines = ['실적 인정 기준', '실적만 있음'];
    const r = run(lines, '실적 기준');
    expect(r.total).toBe(1);
    expect(r.hits[0]!.unit).toBe(0);
  });

  it('표 행에서 두 항이 다른 셀에 있어도 적중', () => {
    const r = run(['[표 1]', '[셀 0 0] 경영상태', '[셀 0 1] 신용평가'], '경영 신용');
    expect(r.total).toBe(1);
    expect(r.hits[0]!.spans.map((s) => s.line).sort()).toEqual([1, 2]);
  });

  it('분해형 한글로 끝나는 항의 강조 범위가 묶음 끝까지 간다', () => {
    const r = run(['다라'.normalize('NFD')], '다라');
    expect(r.hits[0]!.spans).toEqual([{ line: 0, from: 0, to: 4 }]);
  });

  it('spans가 원문 줄·열로 환산된다', () => {
    const r = run(['[셀 0 0] 가나 다라마바'], '다라');
    expect(r.hits[0]!.spans).toEqual([{ line: 0, from: 3, to: 5 }]);
    expect(r.hits[0]!.line).toBe(0);
  });

  it('300건 상한과 total', () => {
    const lines = Array.from({ length: 350 }, (_, i) => `공고 문장 ${i}`);
    const r = run(lines, '공고');
    expect(r.hits).toHaveLength(300);
    expect(r.total).toBe(350);
  });

  it('스니펫 앞뒤 …', () => {
    const long = `${'가'.repeat(200)} 목표단어 ${'나'.repeat(200)}`;
    const r = run([long], '목표단어');
    const s = r.hits[0]!.snippet;
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('목표단어');
    const short = run(['짧은 목표단어 줄'], '목표단어').hits[0]!.snippet;
    expect(short).toBe('짧은 목표단어 줄');
  });

  it('구문은 공백을 무시한 연속 일치', () => {
    const lines = ['실적  인정', '인정 실적'];
    const r = run(lines, '"실적 인정"');
    expect(r.total).toBe(1);
    expect(r.hits[0]!.unit).toBe(0);
  });

  it('질의가 비면 적중 없음', () => {
    expect(run(['가나다'], '가').total).toBe(0);
  });
});
