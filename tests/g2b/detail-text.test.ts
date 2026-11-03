// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import html from '../fixtures/g2b-detail.html?raw';
import { readPageDoc, readPageText } from '../../src/adapters/g2b/detail-text';
import { buildTextBlocks } from '../../src/core/doc/text-blocks';
import { DETAIL_TEXT_MAX_CHARS } from '../../src/core/search/constants';
import type { DocTable } from '../../src/core/doc/model';

// jsdom은 offsetParent가 항상 null이라 display:none 조상 여부로 판정한다.
const isVisible = (el: Element) => !el.closest('[style*="display:none"], [style*="display: none"]');
const opts = { isVisible };

beforeEach(() => { document.documentElement.innerHTML = html; });

describe('readPageDoc', () => {
  it('mainFrame이 없으면 null', () => {
    document.body.innerHTML = '';
    expect(readPageDoc(document, opts)).toBeNull();
    expect(readPageText(document, opts)).toBeNull();
  });

  it('(a) 표를 DocTable로 만든다', () => {
    const doc = readPageDoc(document, opts)!;
    const tables = doc.blocks.filter((b): b is DocTable => b.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(5);
    const first = tables[0]!;
    expect(first.cells.find((c) => c.r === 1 && c.c === 0)!.text).toBe('공고명');
    expect(first.cells.find((c) => c.r === 1 && c.c === 1)!.text).toContain('필리핀 카라바오');
    // _head_table/_body_table은 별개의 표로 남는다
    expect(tables.some((t) => t.cells.some((c) => c.text === '투찰가능한업종'))).toBe(true);
    expect(tables.some((t) => t.cells.some((c) => c.text === '공고서참조'))).toBe(true);
  });

  it('(b) 입력값을 포함한다', () => {
    const text = readPageText(document, opts)!.text;
    expect(text).toContain('R26BK01722175-000');
    expect(text).toContain('2026/10/22 09:00:00'); // 표 밖 input[title]
    expect(text).toContain('0.5');
  });

  it('(c) display:none 요소를 제외한다', () => {
    const text = readPageText(document, opts)!.text;
    expect(text).not.toContain('R99ZZ99999999-001');
    expect(text).not.toContain('숨은값');
  });

  it('(d) 같은 텍스트가 중복되지 않는다', () => {
    const text = readPageText(document, opts)!.text;
    expect(text.split('공고게시').length - 1).toBe(1);
    expect(text.split('2026/10/22 09:00:00').length - 1).toBe(1);
  });

  it('(e) renderText 결과를 buildTextBlocks가 다시 표로 읽는다', () => {
    const text = readPageText(document, opts)!.text;
    const blocks = buildTextBlocks(text.split('\n'));
    const tables = blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(5);
    expect(tables[0]!.kind === 'table' && tables[0]!.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('button·script·style·aria-hidden은 건너뛴다', () => {
    document.querySelector('#mf_wfm_container_mainWframe')!.insertAdjacentHTML('beforeend',
      '<div><button>버튼글자</button><script>var a=1;</script><style>.a{}</style><span aria-hidden="true">가려진글자</span><p>보이는문단</p></div>');
    const text = readPageText(document, opts)!.text;
    expect(text).toContain('보이는문단');
    for (const t of ['버튼글자', 'var a=1', '.a{}', '가려진글자']) expect(text).not.toContain(t);
  });

  it('자식 블록·표 뒤에 오는 텍스트는 앞 문단에 합쳐지지 않고 문서 순서를 지킨다', () => {
    document.querySelector('#mf_wfm_container_mainWframe')!.insertAdjacentHTML('beforeend',
      '<div id="ord">앞글<div>자식글</div><table><tr><td>표칸</td></tr></table>뒤글</div>');
    const lines = readPageText(document, opts)!.text.split('\n');
    const at = (t: string) => lines.findIndex((l) => l.includes(t));
    expect(lines[at('앞글')]).not.toContain('뒤글');
    expect(at('앞글')).toBeLessThan(at('자식글'));
    expect(at('자식글')).toBeLessThan(at('표칸'));
    expect(at('표칸')).toBeLessThan(at('뒤글'));
  });

  it('300,000자를 넘으면 자르고 truncated', () => {
    document.querySelector('#mf_wfm_container_mainWframe')!.insertAdjacentHTML('beforeend', `<div>${'가'.repeat(DETAIL_TEXT_MAX_CHARS + 10)}</div>`);
    const r = readPageText(document, opts)!;
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(DETAIL_TEXT_MAX_CHARS);
    expect(readPageText(document.implementation.createHTMLDocument(''), opts)).toBeNull();
  });

  it('상한 이하면 truncated false', () => {
    expect(readPageText(document, opts)!.truncated).toBe(false);
  });
});
