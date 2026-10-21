// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderText } from '../../../src/core/doc/render-text';
import { extractRequirements } from '../../../src/core/rfp/extract';
import { compareSets } from '../../../src/core/rfp/match';
import { hwp5Parser } from '../../../src/engine/parsers/hwp5/parser';
import { hwpxParser } from '../../../src/engine/parsers/hwpx';
import type { DocParser } from '../../../src/engine/parsers/types';
import type { RequirementSetBody } from '../../../src/core/types/rfp';

const DOCS = 'tests/fixtures/docs';
const A = { dir: 'R26BK01631407', name: '(붙임2) 제안요청서(전자출하시스템 활성화 및 유지보수 사업).hwp', parser: hwp5Parser };
const B = { dir: 'R26BK01592099', name: '제안요청서(축산물원패스 기능 고도화 사업).hwpx', parser: hwpxParser };

async function load(d: { dir: string; name: string; parser: DocParser }): Promise<RequirementSetBody> {
  const bytes = new Uint8Array(readFileSync(`${DOCS}/${d.dir}/${d.name}`));
  const r = await d.parser.parse({ name: d.name, bytes, deadlineAt: Date.now() + 60000 });
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  renderText(r.doc);
  return extractRequirements(r.doc);
}

describe('실문서 RFP 추출·비교', () => {
  let a: RequirementSetBody, b: RequirementSetBody;
  beforeAll(async () => {
    a = await load(A);
    b = await load(B);
    console.log('[rfp] 전자출하', a.items.length, a.quality, JSON.stringify(a.stats), a.warnings);
    console.log('[rfp] 원패스', b.items.length, b.quality, JSON.stringify(b.stats), b.warnings);
  }, 120000);

  it('전자출하: 90건 이상, detail 빈 항목 0, good', () => {
    expect(a.items.length).toBeGreaterThanOrEqual(90);
    expect(a.items.filter((i) => !i.detail)).toEqual([]);
    expect(a.quality).toBe('good');
  });

  it('원패스: 80건 이상, detail 빈 항목 0, good', () => {
    expect(b.items.length).toBeGreaterThanOrEqual(80);
    expect(b.items.filter((i) => !i.detail)).toEqual([]);
    expect(b.quality).toBe('good');
  });

  it('자기 자신과 비교하면 changed·added·removed 0', () => {
    for (const s of [a, b]) {
      const r = compareSets(s.items, s.items);
      expect(r.counts.changed).toBe(0);
      expect(r.counts.added).toBe(0);
      expect(r.counts.removed).toBe(0);
    }
  });

  it('교차 비교: same ≥10, changed ≥20, COR-005 ↔ COR-004 번호만 바뀜', () => {
    const r = compareSets(a.items, b.items);
    console.log('[rfp] 교차', JSON.stringify(r.counts));
    expect(r.counts.same).toBeGreaterThanOrEqual(10);
    expect(r.counts.changed).toBeGreaterThanOrEqual(20);
    const p = r.pairs.find((x) => x.prev?.key === 'COR-005' && x.next?.key === 'COR-004');
    expect(p).toBeDefined();
    expect(p!.status).toBe('changed');
    expect(p!.tags).toEqual(expect.arrayContaining(['renumbered', 'number_only']));
  });
});
