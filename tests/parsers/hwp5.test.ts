import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as CFB from 'cfb';
import { hwp5Parser } from '../../src/engine/parsers/hwp5/parser';
import { allTables, Grid } from '../../src/core/doc/grid';
import { renderText } from '../../src/core/doc/render-text';
import type { DocModel } from '../../src/core/doc/model';

const DIR = 'tests/fixtures/docs/R26BK01722175';
const load = (n: string) => new Uint8Array(readFileSync(`${DIR}/${n}`));
const parse = async (n: string) => {
  const t0 = performance.now();
  const r = await hwp5Parser.parse({ name: n, bytes: load(n), deadlineAt: Date.now() + 20000 });
  const ms = performance.now() - t0;
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return { doc: r.doc, ms };
};
const paras = (doc: DocModel) => doc.blocks.filter((b) => b.kind === 'p').map((b) => (b as { text: string }).text);

describe('hwp5 f3 제안요청서', () => {
  it('정량평가 표 구조와 줄 수', async () => {
    const { doc, ms } = await parse('2. 제안요청서.hwp');
    expect(ms).toBeLessThan(2000);

    const tbl = allTables(doc).find((t) => {
      const h = new Grid(t).headerRow().cells.map((c) => c.text);
      return h.join('|') === '구분|평가부문|평가항목|배점' && new Grid(t).at(1, 0)?.text.startsWith('정량평가');
    })!;
    expect(tbl).toBeDefined();
    const g = new Grid(tbl);
    expect(tbl.rows).toBe(3);
    expect(tbl.cols).toBe(4);
    expect(g.at(1, 0)!.rowSpan).toBe(2);
    expect(g.at(1, 3)!.text).toBe('4');
    expect(g.at(2, 3)!.text).toBe('6');
    expect(g.at(2, 0)).toBe(g.at(1, 0));
    expect(tbl.caption).toBe('<정량평가>');

    // 정량평가 세부 기준표(7x5): r1c2는 colSpan 2 + 중첩 표 1개, r2c0은 rowSpan 5
    const detail = allTables(doc).find((t) => new Grid(t).headerRow().cells.some((c) => c.text === '평가기준'))!;
    expect(detail).toBeDefined();
    expect(detail.rows).toBe(7);
    expect(detail.cols).toBe(5);
    const dg = new Grid(detail);
    expect(dg.at(0, 2)!.colSpan).toBe(2);
    const r1c2 = dg.at(1, 2)!;
    expect(r1c2.colSpan).toBe(2);
    expect(r1c2.blocks.filter((b) => b.kind === 'table')).toHaveLength(1);
    expect(dg.at(2, 0)!.rowSpan).toBe(5);

    // research-f3.txt는 셀 태그와 본문을 별도 줄로 센다. 같은 기준으로 환산해 ±5% 이내인지 본다.
    const rendered = renderText(doc).split('\n');
    const tagWithText = rendered.filter((l) => /^\[셀 \d+ \d+[^\]]*\] \S/.test(l)).length;
    const expected = 10142; // research-f3.txt 줄 수
    const equiv = rendered.length + tagWithText;
    expect(Math.abs(equiv - expected) / expected).toBeLessThan(0.05);
  });
});

describe('hwp5 그 밖의 파일', () => {
  it('f1에 "차등점수제 : 미적용" 문단이 있다', async () => {
    const { doc, ms } = await parse('1. 입찰공고문.hwp');
    expect(ms).toBeLessThan(2000);
    const all = [...paras(doc), ...allTables(doc).flatMap((t) => t.cells.map((c) => c.text))];
    expect(all.some((p) => p.includes('차등점수제 : 미적용'))).toBe(true);
  });
  it('f6은 정상 파싱된다', async () => {
    const { doc, ms } = await parse('5. (참고) 사전공고 질의답변.hwp');
    expect(ms).toBeLessThan(2000);
    expect(doc.stats.chars).toBeGreaterThan(0);
    expect(renderText(doc).split('\n').length).toBeGreaterThan(10);
  });
});

describe('hwp5 합성', () => {
  const flip = (bit: number): Uint8Array => {
    const c = CFB.read(load('1. 입찰공고문.hwp'), { type: 'array' });
    const fh = CFB.find(c, '/FileHeader')!;
    const content = Uint8Array.from(fh.content as ArrayLike<number>);
    content[36] = content[36]! | bit;
    fh.content = content;
    return Uint8Array.from(CFB.write(c, { type: 'array' }) as ArrayLike<number>);
  };
  const run = (bytes: Uint8Array, extra: object = {}) => hwp5Parser.parse({ name: 'a.hwp', bytes, deadlineAt: Date.now() + 20000, ...extra });
  it('암호 비트는 encrypted', async () => expect(await run(flip(2))).toMatchObject({ ok: false, reason: 'encrypted' }));
  it('배포용 비트는 drm', async () => expect(await run(flip(4))).toMatchObject({ ok: false, reason: 'drm' }));
  it('abort된 signal은 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await run(load('1. 입찰공고문.hwp'), { signal: ac.signal })).toMatchObject({ ok: false, reason: 'cancelled' });
  });
  it('BodyText가 없으면 corrupt', async () => {
    const c = CFB.read(load('1. 입찰공고문.hwp'), { type: 'array' });
    CFB.utils.cfb_del(c, '/BodyText/Section0');
    const bytes = Uint8Array.from(CFB.write(c, { type: 'array' }) as ArrayLike<number>);
    // 섹션이 하나뿐이 아닐 수 있어 남은 섹션도 모두 지운다
    const c2 = CFB.read(bytes, { type: 'array' });
    for (const p of c2.FullPaths.filter((x) => /BodyText\/Section\d+$/.test(x))) CFB.utils.cfb_del(c2, p);
    const out = Uint8Array.from(CFB.write(c2, { type: 'array' }) as ArrayLike<number>);
    expect(await run(out)).toMatchObject({ ok: false, reason: 'corrupt' });
  });
});
