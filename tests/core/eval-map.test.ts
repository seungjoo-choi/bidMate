import { describe, expect, it } from 'vitest';
import type { EvalRaw } from '../../src/adapters/g2b/eval-api';
import { mapEvalRaw } from '../../src/core/evaluation/map';
import type { EvalRecord } from '../../src/core/types/evaluation';
import raw from '../fixtures/eval-raw-sample.json';

const REF = { noticeNo: 'R26BK01631407', round: '000' };
const NOW = '2026-10-19T00:00:00.000Z';
const map = (r: unknown) => mapEvalRaw(r as EvalRaw, REF, NOW);
const clone = (): EvalRaw => JSON.parse(JSON.stringify(raw));
const rec = (): EvalRecord => {
  const r = map(raw);
  if (!r.ok) throw new Error(r.message);
  return r.record;
};
const totals = (r: EvalRecord, bizNo: string) => {
  const seq = r.bidders.find((b) => b.bizNo === bizNo)!.seq;
  return r.judges.map((j) => {
    const sum = r.scores.filter((s) => s.b === seq && s.j === j.index).reduce((a, s) => a + s.s, 0);
    return Math.round(sum * 10) / 10;
  });
};

describe('mapEvalRaw', () => {
  it('위원별 합계가 검증값과 일치한다', () => {
    const r = rec();
    expect(totals(r, '5978600662')).toEqual([84.1, 88.7, 85.5, 82.4, 80.8, 84, 87.4, 84.9]);
    expect(totals(r, '1198633696')).toEqual([79, 80.4, 75.3, 79.4, 75.3, 81, 84.1, 77.1]);
  });

  it('항목, 위원, 상태와 경고', () => {
    const r = rec();
    expect(r.items).toHaveLength(24);
    expect(r.items.every((i) => i.leaf && i.depth === 2)).toBe(true);
    expect(r.judges).toHaveLength(8);
    expect(r.judges[0]!.key).toBe('J001');
    expect(r.status).toBe('final');
    expect(r.techWeight).toBe(90);
    expect(r.scores).toHaveLength(384);
    expect(r.warnings).toEqual([]);
    expect(r.noticeId).toBe('R26BK01631407-000');
    expect(r.firstCollectedAt).toBe(NOW);
  });

  it('record JSON에 elmbHashVal 값이 없다', () => {
    const json = JSON.stringify(rec());
    for (const m of (raw as EvalRaw).members) expect(json).not.toContain(m.elmbHashVal);
    expect(json).not.toContain('elmbHashVal');
  });

  it('수정 이력 점수는 s와 다를 때만 r로 남긴다', () => {
    const x = clone();
    x.scores[0]!.rvsoEvlHistScr = x.scores[0]!.evlScr! + 1;
    x.scores[1]!.rvsoEvlHistScr = x.scores[1]!.evlScr;
    const r = map(x);
    if (!r.ok) throw new Error(r.message);
    expect(r.record.scores[0]!.r).toBe(x.scores[0]!.evlScr! + 1);
    expect(r.record.scores[1]!.r).toBeUndefined();
  });

  it('맵에 없는 hash 행과 숫자 아닌 점수는 버리고 경고하며, 중복은 뒤 값을 버린다', () => {
    const x = clone();
    x.scores.push({ ...x.scores[0]!, elmbHashVal: 'ZZZ' });
    x.scores.push({ ...x.scores[2]!, evlScr: 1 }); // 중복 키
    x.scores[3]!.evlScr = null;
    const r = map(x);
    if (!r.ok) throw new Error(r.message);
    expect(r.record.scores).toHaveLength(383);
    expect(r.record.warnings.some((w) => w.includes('위원을 찾지 못한'))).toBe(true);
    expect(r.record.warnings.some((w) => w.includes('중복'))).toBe(true);
    expect(r.record.warnings.some((w) => w.includes('칸 수'))).toBe(true);
  });

  it('업체에 없는 seq와 leaf가 아닌 항목의 점수는 버리고 각각 경고 1회', () => {
    const x = clone();
    const leaf = x.items[0]!;
    x.items.push({ ...leaf, evlPritmNo: 'PARENT', upEvlPritmNo: null });
    x.items[1]!.upEvlPritmNo = 'PARENT';
    x.scores.push({ ...x.scores[0]!, evlTrgtSqno: 99 }, { ...x.scores[0]!, evlTrgtSqno: 99 });
    x.scores.push({ ...x.scores[0]!, evlPritmNo: 'PARENT' });
    const r = map(x);
    if (!r.ok) throw new Error(r.message);
    expect(r.record.warnings.filter((w) => w.includes('업체를 찾지 못한'))).toHaveLength(1);
    expect(r.record.warnings.filter((w) => w.includes('세부항목이 아닌'))).toHaveLength(1);
    expect(r.record.scores.every((s) => s.b !== 99 && s.i !== 'PARENT')).toBe(true);
  });

  it('칸 수가 다르면 경고, 필수 요소가 비면 EVAL_PARSE', () => {
    const x = clone();
    x.scores = x.scores.slice(0, 10);
    const r = map(x);
    expect(r.ok && r.record.warnings.some((w) => w.includes('칸 수'))).toBe(true);
    for (const k of ['targets', 'members', 'items', 'scores'] as const) {
      const y = clone();
      (y[k] as unknown[]) = [];
      expect(map(y)).toMatchObject({ ok: false, code: 'EVAL_PARSE' });
    }
    const z = clone();
    z.open.evlNo = null;
    expect(map(z)).toMatchObject({ ok: false, code: 'EVAL_PARSE' });
  });

  it('사업자번호가 10자리가 아니면 경고한다', () => {
    const x = clone();
    x.targets[0]!.bzmnRegNo = '123';
    const r = map(x);
    expect(r.ok && r.record.warnings.some((w) => w.includes('사업자번호'))).toBe(true);
  });
});
