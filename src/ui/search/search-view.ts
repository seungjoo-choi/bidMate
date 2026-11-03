import { displayLine, PAGE_RE } from '../../core/doc/text-blocks';
import { DETAIL_KIND_LABEL } from '../../core/model/detail-text';
import type { SearchDoc, SearchHit, SearchQuery } from '../../core/search/types';
import type { Extraction } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import type { NoticeTexts } from '../../core/types/search';
import { DOC_KIND_LABEL } from '../review/view';
import { buildFieldDoc, type FieldDoc } from './field-doc';

/** TextDrawer 열기 대상(entrypoints의 DrawerTarget과 같은 모양, ui가 entrypoints 컴포넌트를 import하지 않으려고 따로 둔다). */
export interface SearchDrawerTarget { textPath: string; line?: number; title: string; query?: string }

/** 항목값 → 상세 전문 → 첨부(priority 순, 같으면 입력 순서) 문서 목록. 본문이 빈 파일(총량 상한 초과)은 뺀다. */
export function buildSearchDocs(notice: Notice, extraction: Extraction | null, texts: NoticeTexts): SearchDoc[] {
  const docs: SearchDoc[] = [buildFieldDoc(notice, extraction)];
  const files = texts.files.map((f, i) => ({ f, i })).filter(({ f }) => f.text !== '')
    .sort((a, b) => a.f.priority - b.f.priority || a.i - b.i);
  for (const { f } of files) {
    const lines = f.text.split('\n');
    if (f.kind === 'detail') {
      docs.push({ id: f.id, kind: 'detail', label: '나라장터 상세화면', kindLabel: DETAIL_KIND_LABEL, textPath: f.textPath, priority: f.priority, lines });
    } else {
      const kind = f.docKind ? DOC_KIND_LABEL[f.docKind] ?? f.docKind : '첨부';
      docs.push({ id: f.id, kind: 'attachment', label: f.name, kindLabel: `${f.origin === 'prespec' ? '사전규격 / ' : ''}${kind}`, textPath: f.textPath, priority: f.priority, lines });
    }
  }
  return docs;
}

const noticeHref = (id: string, tab?: 'review') => `#/notices/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`;

export const groupLabel = (doc: SearchDoc): string => `${doc.kindLabel} · ${doc.label}`;

/** TextDrawer의 line은 1부터라 hit.line(0부터)에 1을 더한다. textPath가 없는 문서(항목값)는 null. */
export function drawerTargetOf(hit: SearchHit, doc: SearchDoc, query: SearchQuery): SearchDrawerTarget | null {
  if (!doc.textPath) return null;
  // 드로어는 줄 안 통째 포함만 보므로 질의 원문 대신 적중한 실제 표기를 넘긴다.
  return { textPath: doc.textPath, line: hit.line + 1, title: doc.label, query: hitNeedles(hit, doc)[0] ?? query.raw };
}

/** 항목값 결과의 이동 링크. reviewKey가 있으면 검토 탭, 없으면 개요. 그룹 머리 줄이나 항목값 문서가 아니면 null. */
export function fieldLinkOf(hit: SearchHit, doc: SearchDoc): { hash: string; label: string } | null {
  if (doc.kind !== 'fields') return null;
  const m = (doc as FieldDoc).meta?.[hit.line];
  if (!m) return null;
  const id = (doc as FieldDoc).noticeId;
  return m.reviewKey ? { hash: noticeHref(id, 'review'), label: '검토 탭에서 보기' } : { hash: noticeHref(id), label: '개요 탭에서 보기' };
}

/** 줄별 쪽 번호(`[p N]` 이후 줄). 쪽 표시가 없는 문서는 전부 null. */
export function pageMap(lines: string[]): Array<string | null> {
  let cur: string | null = null;
  return lines.map((l) => {
    const m = PAGE_RE.exec(l);
    if (m) cur = m[1]!;
    return cur;
  });
}

export interface SnippetPart { text: string; mark: boolean }

/** 스니펫에서 적중 텍스트를 표시 구간으로 나눈다(대소문자 무시). 표시할 말은 spans가 가리키는 displayLine 조각이다. */
export function snippetParts(snippet: string, needles: string[]): SnippetPart[] {
  const low = snippet.toLowerCase();
  const marks: Array<[number, number]> = [];
  for (const n of new Set(needles.map((s) => s.toLowerCase()).filter(Boolean))) {
    for (let at = low.indexOf(n); at >= 0; at = low.indexOf(n, at + n.length)) marks.push([at, at + n.length]);
  }
  marks.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const parts: SnippetPart[] = [];
  let pos = 0;
  for (const [s, e] of marks) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    if (from > pos) parts.push({ text: snippet.slice(pos, from), mark: false });
    parts.push({ text: snippet.slice(from, e), mark: true });
    pos = e;
  }
  if (pos < snippet.length) parts.push({ text: snippet.slice(pos), mark: false });
  return parts;
}

/** 적중에서 강조할 말들. spans가 가리키는 displayLine 조각(원문 표기 그대로, 띄어쓰기 포함). */
export function hitNeedles(hit: SearchHit, doc: SearchDoc): string[] {
  return hit.spans.map((s) => displayLine(doc.lines[s.line] ?? '').slice(s.from, s.to)).filter(Boolean);
}
