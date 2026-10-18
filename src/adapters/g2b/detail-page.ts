import type { HtmlFields } from '../../core/types/job';
import { resolveRef } from './openapi';

/** 나라장터 상세화면 DOM 읽기(읽기 전용). DOM을 인자로 받는 순수 함수만 둔다. */
export const MAIN_FRAME_SELECTOR = '#mf_wfm_container_mainWframe';
const GRID_LCNS = '#mf_wfm_container_mainWframe_grdLcnsLmt_body_table';
const GRID_PROGRESS = '#mf_wfm_container_mainWframe_gridList1_body_table';

export type VisibleFn = (el: Element) => boolean;
export interface ReadOpts { isVisible?: VisibleFn; now?: Date; url?: string }

/** 보이는 요소만: offsetParent가 있고 rect 크기가 0보다 크다. */
export const defaultIsVisible: VisibleFn = (el) => {
  const h = el as HTMLElement;
  if (h.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function mainFrame(doc: Document): Element | null {
  return doc.querySelector(MAIN_FRAME_SELECTOR);
}

const FIELD_SEL = 'input[title], textarea[title]';
type Field = HTMLInputElement | HTMLTextAreaElement;

/** title이 같고(공백 정규화) 보이는 input/textarea 중 첫 번째. 기본은 value가 빈 것을 건너뛴다. */
function findInput(root: Element, title: string, vis: VisibleFn, allowEmpty = false): Field | null {
  const want = norm(title);
  for (const el of Array.from(root.querySelectorAll<Field>(FIELD_SEL))) {
    if (norm(el.getAttribute('title')) !== want || !vis(el)) continue;
    if (allowEmpty || norm(el.value)) return el;
  }
  return null;
}
const inputValue = (root: Element, title: string, vis: VisibleFn): string => norm(findInput(root, title, vis)?.value);

function cellValue(cell: Element): string {
  const input = cell.querySelector('input');
  return norm(input ? input.value : cell.textContent);
}

/** 텍스트가 일치(또는 predicate)하는 보이는 th/td. */
function findCells(root: Element, match: (text: string) => boolean, vis: VisibleFn): Element[] {
  return Array.from(root.querySelectorAll('th,td')).filter((c) => match(norm(c.textContent)) && vis(c));
}
function nextCellValue(cell: Element): string {
  const sib = cell.nextElementSibling;
  return sib && /^(TD|TH)$/i.test(sib.tagName) ? cellValue(sib) : '';
}
function labelValue(root: Element, label: string, vis: VisibleFn): string {
  for (const c of findCells(root, (t) => t === label, vis)) {
    const v = nextCellValue(c);
    if (v) return v;
  }
  return '';
}

/**
 * 그리드 데이터 행을 읽는다. 헤더는 `_head_table`에서 먼저, 없으면 body_table의 thead/행에서 찾는다.
 * 헤더 이름을 못 찾으면 오판 대신 빈 결과를 반환한다.
 */
function readGrid(doc: Document, bodySel: string, cols: string[], vis: VisibleFn): string[][] {
  const body = doc.querySelector(bodySel);
  if (!body) return [];
  const cellsOf = (r: Element) => Array.from(r.children).map((c) => norm(c.textContent));
  const hasAll = (r: Element) => { const t = cellsOf(r); return cols.every((c) => t.includes(c)); };
  const head = doc.querySelector(bodySel.replace(/_body_table$/, '_head_table'));
  const bodyRows = Array.from(body.querySelectorAll('tr'));
  let header: string[] | null = null;
  let firstData = 0;
  const headRow = head ? Array.from(head.querySelectorAll('tr')).find(hasAll) : undefined;
  if (headRow) {
    header = cellsOf(headRow);
    // 헤더가 body에도 반복될 수 있으니 같은 행은 건너뛴다.
  } else {
    const i = bodyRows.findIndex(hasAll);
    if (i >= 0) { header = cellsOf(bodyRows[i]!); firstData = i + 1; }
  }
  if (!header) return [];
  const idx = cols.map((c) => header!.indexOf(c));
  const out: string[][] = [];
  for (const r of bodyRows.slice(firstData)) {
    if (r.closest('thead') || r.querySelector('th') || !vis(r) || hasAll(r)) continue;
    const cells = cellsOf(r);
    if (cells.every((c) => c === '')) continue;
    out.push(idx.map((i) => cells[i] ?? ''));
  }
  return out;
}

export interface DetectedDetail { noticeNo: string; round?: string }

/** 상세화면이면 공고번호를 반환한다. value 형식이 미확인이라 resolveRef로 파싱하고, 실패하면 URL의 bidPbancNo를 쓴다. */
export function detectDetail(doc: Document, opts: ReadOpts = {}): DetectedDetail | null {
  const root = mainFrame(doc);
  if (!root) return null;
  const input = findInput(root, '입찰공고번호', opts.isVisible ?? defaultIsVisible, true);
  if (!input) return null;
  const fromUrl = (): DetectedDetail | null => {
    try {
      const u = new URL(opts.url ?? doc.location?.href ?? '');
      const ref = resolveRef(u.searchParams.get('bidPbancNo') ?? ''); // 형식 검증을 통과한 번호만 쓴다
      const ord = u.searchParams.get('bidPbancOrd');
      return ref ? { noticeNo: ref.noticeNo, ...(ord ? { round: ord.trim() } : {}) } : null;
    } catch { return null; }
  };
  const value = norm(input.value);
  const ref = value ? resolveRef(value) : null;
  if (ref) {
    let round = ref.round;
    if (!round) { const u = fromUrl(); if (u && u.noticeNo === ref.noticeNo) round = u.round; }
    return { noticeNo: ref.noticeNo, ...(round ? { round } : {}) };
  }
  return fromUrl();
}

/** 입찰공고번호 input의 원문 value만 가볍게 확인한다(값만 바뀌는 공고 전환 감지용). 없으면 null. */
export function peekNoticeValue(doc: Document, opts: ReadOpts = {}): string | null {
  const root = mainFrame(doc);
  if (!root) return null;
  const el = findInput(root, '입찰공고번호', opts.isVisible ?? defaultIsVisible, true);
  return el ? norm(el.value) : null;
}

export function readPageTitle(doc: Document, opts: ReadOpts = {}): string | undefined {
  const root = mainFrame(doc);
  if (!root) return undefined;
  return labelValue(root, '공고명', opts.isVisible ?? defaultIsVisible) || undefined;
}

/** API에 없는 항목만 읽는다. 다른 항목은 형식 차이로 API 값과 거짓 충돌이 나므로 읽지 않는다. */
export function readHtmlFields(doc: Document, opts: ReadOpts = {}): HtmlFields {
  const vis = opts.isVisible ?? defaultIsVisible;
  const fields: HtmlFields['fields'] = {};
  const root = mainFrame(doc);
  const out: HtmlFields = { fields, capturedAt: (opts.now ?? new Date()).toISOString() };
  if (!root) return out;
  const put = (key: keyof HtmlFields['fields'], raw: string, ref: string) => {
    const r = raw.trim();
    if (r) fields[key] = { raw: r, ref };
  };

  // 투찰가능업종
  const lcns = readGrid(doc, GRID_LCNS, ['투찰가능한업종', '허용업종'], vis)
    .filter(([a, b]) => a || b)
    .map(([a, b]) => `투찰가능: ${a || '-'} / 허용: ${b || '-'}`);
  put('eligibility', lcns.join('; '), 'grid:grdLcnsLmt');

  // 제안서 제출기간
  const start = inputValue(root, '최종제안서 제출시작일시', vis);
  const end = inputValue(root, '최종제안서 제출마감일시', vis);
  put('proposalPeriod', start && end ? `${start} ~ ${end}` : start || end, 'title=최종제안서 제출시작일시|마감일시');

  // 제안서 평가(발표)일시
  const cellVal = labelValue(root, '제안서발표', vis);
  if (cellVal) put('proposalEvalAt', cellVal, 'cell:제안서발표');
  else {
    const row = readGrid(doc, GRID_PROGRESS, ['진행명', '시작일시'], vis)
      .find(([name]) => name!.includes('제안서') && (name!.includes('평가') || name!.includes('발표')));
    if (row) put('proposalEvalAt', row[1]!, 'grid:gridList1');
  }

  put('differentialScoring', inputValue(root, '차등점수제 순위간 점수차', vis), 'title=차등점수제 순위간 점수차');

  // 사업기간/계약기간
  const periodRe = /사업기간|계약기간/;
  const pInput = Array.from(root.querySelectorAll<Field>(FIELD_SEL))
    .find((el) => periodRe.test(norm(el.getAttribute('title'))) && vis(el) && norm(el.value));
  if (pInput) put('projectPeriod', pInput.value, `title=${norm(pInput.getAttribute('title'))}`);
  else {
    for (const c of findCells(root, (t) => t.length <= 20 && periodRe.test(t), vis)) {
      const v = nextCellValue(c);
      if (v) { put('projectPeriod', v, `cell:${norm(c.textContent)}`); break; }
    }
  }

  const title = labelValue(root, '공고명', vis);
  if (title) out.pageTitle = title;
  return out;
}
