import { describe, expect, it, vi } from 'vitest';

const renderCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/core/ai/excerpt', async (orig) => {
  const m = await orig<typeof import('../../src/core/ai/excerpt')>();
  return { ...m, renderLines: (lines: string[]) => { renderCalls.n++; return m.renderLines(lines); } };
});

import { ASK_FILE_MAX_CHARS } from '../../src/core/search/constants';
import { renderAskExcerpt } from '../../src/core/search/ask-prompt';
import { selectContext } from '../../src/core/search/context';
import type { SearchDoc, SearchUnit } from '../../src/core/search/types';
import { buildUnits } from '../../src/core/search/units';

const doc = (id: string, lines: string[], kind: SearchDoc['kind'] = 'attachment'): SearchDoc =>
  ({ id, kind, label: id, kindLabel: '문서', textPath: `p/${id}.txt`, priority: 1, lines });
const unitsOf = (docs: SearchDoc[]): Record<string, SearchUnit[]> => Object.fromEntries(docs.map((d) => [d.id, buildUnits(d.lines)]));
const filler = (n: number, tag = '채움') => Array.from({ length: n }, (_, i) => `${tag}${i}번줄입니다`);

describe('selectContext', () => {
  it('표 행 적중 시 표 전체와 뒤 주석 줄을 포함한다', () => {
    const lines = [
      ...filler(30),
      '[표 1]',
      '[셀 0 0] 구분', '[셀 0 1] 배점',
      '[셀 1 0] 보증금면제', '[셀 1 1] 가능',
      '[셀 2 0] 기타', '[셀 2 1] 불가',
      '※ 면제 조건은 별도 확인',
      '* 두번째 주석',
      '일반문장입니다',
      ...filler(30, '뒤'),
    ];
    const d = doc('a', lines);
    const segs = selectContext([d], unitsOf([d]), '보증금면제');
    const seg = segs.find((s) => s.from <= 30 && s.to >= 31)!;
    expect(seg).toBeTruthy();
    expect(seg.from).toBeLessThanOrEqual(30);
    expect(seg.to).toBeGreaterThanOrEqual(38);
    expect(seg.text).toContain('구분 | 배점');
    expect(seg.text).toContain('※ 면제 조건은 별도 확인');
    expect(seg.text).toContain('* 두번째 주석');
  });

  it('표 밖 유닛은 앞 4줄·뒤 12줄 창으로 넓히고 겹치면 병합한다', () => {
    const lines = filler(60);
    lines[20] = '보증금면제여부'; lines[25] = '보증금면제조건';
    const d = doc('a', lines);
    const segs = selectContext([d], unitsOf([d]), '보증금면제');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.from).toBe(16);
    expect(segs[0]!.to).toBe(37);
  });

  it('파일당·총 상한을 지킨다', () => {
    const big = (id: string) => doc(id, Array.from({ length: 2000 }, (_, i) => `보증금면제 ${'가'.repeat(80)} ${i}`));
    const docs = [big('a'), big('b'), big('c')];
    const segs = selectContext(docs, unitsOf(docs), '보증금면제', 20_000);
    const per = (id: string) => segs.filter((s) => s.docId === id).reduce((n, s) => n + s.text.length + 1, 0);
    for (const id of ['a', 'b', 'c']) expect(per(id)).toBeLessThanOrEqual(ASK_FILE_MAX_CHARS);
    expect(per('a') + per('b') + per('c')).toBeLessThanOrEqual(20_000);
    expect(per('a')).toBeGreaterThan(0);
  });

  it('적중 0이면 문서마다 앞 60줄', () => {
    const d = doc('a', filler(200));
    const segs = selectContext([d], unitsOf([d]), 'zzzqqq');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.from).toBe(0);
    expect(segs[0]!.to).toBe(59);
  });

  it('항목값 문서는 항상 전부, 맨 앞', () => {
    const f = doc('f', ['공고명: 시험', '예산: 없음'], 'fields');
    const d = doc('a', ['보증금면제 안내']);
    const segs = selectContext([d, f], unitsOf([d, f]), '보증금면제');
    expect(segs[0]!.docId).toBe('f');
    expect(segs[0]!.from).toBe(0);
    expect(segs[0]!.to).toBe(1);
    expect(segs.some((s) => s.docId === 'a')).toBe(true);
    const none = selectContext([d, f], unitsOf([d, f]), 'zzzqqq');
    expect(none[0]!.docId).toBe('f');
  });

  it('후보가 매우 많은 큰 문서 2개도 상한을 지키고 renderLines 호출이 제한적이다', () => {
    const big = (id: string) => doc(id, Array.from({ length: 3000 }, (_, i) => `보증금면제 ${'가'.repeat(80)} ${i}`));
    const docs = [big('a'), big('b')];
    const units = unitsOf(docs);
    renderCalls.n = 0;
    const t0 = Date.now();
    const segs = selectContext(docs, units, '보증금면제');
    const ms = Date.now() - t0;
    const per = (id: string) => segs.filter((s) => s.docId === id).reduce((n, s) => n + s.text.length + 1, 0);
    expect(per('a')).toBeLessThanOrEqual(ASK_FILE_MAX_CHARS);
    expect(per('b')).toBeLessThanOrEqual(ASK_FILE_MAX_CHARS);
    expect(per('a')).toBeGreaterThan(10_000);
    expect(renderCalls.n).toBeLessThan(1000); // 후보 6000개를 모두 다시 그리지 않는다
    expect(ms).toBeLessThan(3000);
  });

  it('창이 상한을 넘으면 표 행 유닛이 앞부분 때문에 탈락하지 않도록 창 앞을 당긴다', () => {
    const lines = ['[표 1]'];
    for (let r = 0; r < 100; r++) lines.push(`[셀 ${r} 0] 항목${r}`, `[셀 ${r} 1] ${r === 50 ? '유일한특수문구' : '내용'}`);
    const d = doc('a', lines);
    const segs = selectContext([d], unitsOf([d]), '유일한특수문구', 800);
    expect(segs.some((s) => s.text.includes('유일한특수문구'))).toBe(true);
  });

  it('예산은 파일·세그먼트 머리줄을 포함해 실제 발췌 길이를 넘지 않는다', () => {
    const big = (id: string) => doc(id, Array.from({ length: 400 }, (_, i) => `보증금면제 ${'가'.repeat(40)} ${i}`));
    const docs = [big('a'), big('b')];
    const budget = 6_000;
    const segs = selectContext(docs, unitsOf(docs), '보증금면제', budget);
    expect(renderAskExcerpt(docs, segs).length).toBeLessThanOrEqual(budget);
  });

  describe.each([31_000, 40_000].map((budget) => ({ budget })))('큰 코퍼스(문서 4개 x 4000줄, 줄 250자, 적중 50%) 예산 $budget', ({ budget }) => {
    const mk = (id: string) => doc(id, Array.from({ length: 4000 }, (_, i) => (i % 2 === 0 ? `보증금면제 ${'가'.repeat(230)} ${i}` : `무관한문장 ${'나'.repeat(230)} ${i}`)));
    const docs = ['a', 'b', 'c', 'd'].map(mk);
    const units = unitsOf(docs);
    it('발췌 길이가 예산 이하, 1초 미만, 결정적', () => {
      renderCalls.n = 0;
      const t0 = Date.now();
      const segs = selectContext(docs, units, '보증금면제', budget);
      const ms = Date.now() - t0;
      expect(renderAskExcerpt(docs, segs).length).toBeLessThanOrEqual(budget);
      expect(ms).toBeLessThan(1000);
      expect(selectContext(docs, units, '보증금면제', budget)).toEqual(segs);
    });
  });
});
