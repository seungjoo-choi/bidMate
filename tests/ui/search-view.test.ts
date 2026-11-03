import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { buildUnits } from '../../src/core/search/units';
import { searchDoc } from '../../src/core/search/match';
import { parseQuery } from '../../src/core/search/normalize';
import type { NoticeTextFile, NoticeTexts } from '../../src/core/types/search';
import { buildFieldDoc, type FieldDoc } from '../../src/ui/search/field-doc';
import { buildSearchDocs, drawerTargetOf, fieldLinkOf, pageMap, snippetParts } from '../../src/ui/search/search-view';

const notice = () => emptyNotice('R26BK00000001-000', { noticeNo: 'R26BK00000001', round: '000' } as never, 'notices/A', '2026-10-22T00:00:00+09:00');
const f = (id: string, kind: NoticeTextFile['kind'], priority: number, text = 'x'): NoticeTextFile => ({ id, kind, textPath: `notices/A/source/text/${id}.txt`, name: `${id}.hwp`, priority, text, truncated: false, ...(kind === 'attachment' ? { docKind: 'rfp' as const } : {}) });
const texts = (files: NoticeTextFile[]): NoticeTexts => ({ noticeId: 'R26BK00000001-000', extractionJobId: null, files, skipped: [], totalChars: 0 });

describe('buildSearchDocs', () => {
  it('항목값 → 상세 → 첨부(priority 순) 순서로 만들고 본문이 빈 파일은 뺀다', () => {
    const docs = buildSearchDocs(notice(), null, texts([f('b', 'attachment', 5), f('d', 'detail', 0), f('a', 'attachment', 1), f('c', 'attachment', 5), f('e', 'attachment', 9, '')]));
    expect(docs.map((d) => [d.kind, d.id])).toEqual([['fields', 'fields'], ['detail', 'd'], ['attachment', 'a'], ['attachment', 'b'], ['attachment', 'c']]);
  });
  it('사전규격 첨부는 종류 앞에 "사전규격 /"이 붙는다', () => {
    const docs = buildSearchDocs(notice(), null, texts([{ ...f('p', 'attachment', 1), origin: 'prespec' }]));
    expect(docs[1]!.kindLabel).toBe('사전규격 / 제안요청서');
  });
});

describe('drawerTargetOf', () => {
  it('line을 1부터로 바꾸고 질의 원문을 넘긴다', () => {
    const docs = buildSearchDocs(notice(), null, texts([f('a', 'attachment', 1, '첫째 줄\n실적 인정 기간은 3년')]));
    const q = parseQuery('실적인정기간');
    const doc = docs[1]!;
    const { hits } = searchDoc(doc, buildUnits(doc.lines), q);
    expect(hits[0]!.line).toBe(1);
    expect(drawerTargetOf(hits[0]!, doc, q)).toEqual({ textPath: 'notices/A/source/text/a.txt', line: 2, title: 'a.hwp', query: '실적 인정 기간' });
  });
  it('드로어 query는 질의 원문이 아니라 적중한 원문 표기다(띄어쓰기·여러 단어·구문)', () => {
    const docs = buildSearchDocs(notice(), null, texts([f('a', 'attachment', 1, '입찰 보증금은 납부 대상이다')]));
    const doc = docs[1]!;
    for (const [raw, want] of [['입찰보증금', '입찰 보증금'], ['보증금 납부', '보증금'], ['"입찰 보증금"', '입찰 보증금']] as const) {
      const q = parseQuery(raw);
      const { hits } = searchDoc(doc, buildUnits(doc.lines), q);
      expect(drawerTargetOf(hits[0]!, doc, q)!.query).toBe(want);
    }
  });
  it('한 검색어가 표 셀 줄을 걸쳐 적중하면 첫 줄 조각과 그 줄 위치를 쓴다', () => {
    const docs = buildSearchDocs(notice(), null, texts([f('a', 'attachment', 1, '머리말\n[표 1]\n[셀 1 1] 입찰\n[셀 1 2] 보증금')]));
    const doc = docs[1]!;
    const q = parseQuery('입찰보증금');
    const { hits } = searchDoc(doc, buildUnits(doc.lines), q);
    const t = drawerTargetOf(hits[0]!, doc, q)!;
    expect(t.line).toBe(3);
    expect(t.query).toBe('입찰');
  });
  it('항목값 문서는 textPath가 없어 null', () => {
    const doc = buildFieldDoc(notice(), null);
    expect(drawerTargetOf({ docId: 'fields', unit: 0, line: 0, spans: [], snippet: '' }, doc, parseQuery('ab'))).toBeNull();
  });
});

describe('buildFieldDoc', () => {
  it('값이 —인 행을 빼고 "라벨: 값" 줄과 그룹 머리 줄을 만든다', () => {
    const n = notice();
    n.basic.orderingOrg = { ...n.basic.orderingOrg, value: '테스트기관', status: 'confirmed' } as never;
    const doc = buildFieldDoc(n, null);
    expect(doc.lines.some((l) => /^\[.+\]$/.test(l))).toBe(true);
    expect(doc.lines.some((l) => l.endsWith(': —'))).toBe(false);
    expect(doc.lines.length).toBe(doc.meta.length);
    expect(doc.lines.join('\n')).toContain('테스트기관');
  });
  it('검토 키가 있는 라벨은 검토 탭 링크, 아니면 개요 링크', () => {
    const doc: FieldDoc = { id: 'fields', kind: 'fields', noticeId: 'R26BK00000001-000', label: '', kindLabel: '', priority: -1, lines: ['[그룹]', '사업금액: 1원', '발주기관: 가'], meta: [{ groupId: 'g', label: '' }, { groupId: 'g', label: '사업금액', reviewKey: 'budgetAmount' }, { groupId: 'g', label: '발주기관' }] };
    const hit = (line: number) => ({ docId: 'fields', unit: 0, line, spans: [], snippet: '' });
    expect(fieldLinkOf(hit(1), doc)).toEqual({ hash: '#/notices/R26BK00000001-000/review', label: '검토 탭에서 보기' });
    expect(fieldLinkOf(hit(2), doc)).toEqual({ hash: '#/notices/R26BK00000001-000', label: '개요 탭에서 보기' });
  });
});

describe('pageMap·snippetParts', () => {
  it('[p N] 이후 줄에 쪽 번호를 붙인다', () => {
    expect(pageMap(['a', '[p 2]', 'b', 'c', '[p 3]', 'd'])).toEqual([null, '2', '2', '2', '3', '3']);
  });
  it('스니펫에서 적중 말을 대소문자 무시로 나눈다', () => {
    expect(snippetParts('…실적 인정 기간은 3년', ['실적 인정'])).toEqual([{ text: '…', mark: false }, { text: '실적 인정', mark: true }, { text: ' 기간은 3년', mark: false }]);
  });
});
