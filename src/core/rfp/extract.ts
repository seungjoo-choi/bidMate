import { Grid, allTables } from '../doc/grid';
import type { DocCell, DocModel, DocTable } from '../doc/model';
import { PARA_DETAIL_MAX } from './constants';
import { PREFIX_LABELS, parseReqId } from './ids';
import type { RequirementItem, RequirementSetBody } from '../types/rfp';

/**
 * 제안요청서 DocModel에서 요구사항을 뽑는다. 반드시 renderText(doc) 뒤에 부른다(loc.line을 renderText가 채운다).
 *
 * 인식하는 형식
 * - 카드형: "라벨 | 값" 쌍이 반복되는 표(요구사항 고유번호/명칭/분류/정의/세부내용). 값은 라벨 오른쪽 첫 비어 있지 않은 셀.
 *   그룹 라벨("요구사항 상세설명") 오른쪽이 하위 라벨이면 하위 라벨을, 값이면 그룹 라벨 자체를 세부내용으로 본다.
 * - 목록형: 헤더 행에 고유번호 계열 라벨 + 다른 라벨이 있는 표, 또는 번호 셀이 3개 이상인 열이 있는 표(요약표).
 * - 문단형: 표에서 3건 미만일 때만. "SFR-001 명칭" 문단부터 다음 번호 문단·짧은 번호 제목 전까지.
 */

type Field = 'id' | 'name' | 'category' | 'definition' | 'detail';
const LABELS: Record<string, Field> = {};
const put = (f: Field, ...ls: string[]) => { for (const l of ls) LABELS[l] = f; };
put('id', '요구사항고유번호', '고유번호', '요구사항번호', '요구사항id', 'id', '식별번호', '식별자', '요구사항식별번호');
put('name', '요구사항명칭', '요구사항명', '명칭', '요구사항이름', '항목명');
put('category', '요구사항분류', '분류', '구분', '유형');
put('definition', '정의', '요구사항정의', '개요');
put('detail', '세부내용', '상세내용', '요구사항세부내용', '내용', '요구사항내용');
const GROUP = new Set(['요구사항상세설명', '상세설명', '설명', '요구사항상세내용']);
const CONTENT_FIELDS = ['name', 'category', 'definition', 'detail'] as const;

const normLabel = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\s()（）[\]·:：*※]/g, '');
const isLabel = (s: string) => { const n = normLabel(s); return n.length > 0 && n.length <= 14 && (n in LABELS || GROUP.has(n)); };
/** 원문 탭은 공백으로(탭은 중첩 표의 칸 구분자로만 쓴다) */
const untab = (s: string) => s.replace(/\t/g, ' ');
const isEmpty = (c: DocCell) => !c.text.trim() && c.blocks.length === 0;

/**
 * 셀 문단 + 중첩 표. 중첩 표는 한 행을 한 줄로, 칸은 탭으로 잇는다(화면이 탭을 칸 구분선으로 그린다).
 * 칸이 하나뿐인 행(글상자처럼 감싼 표)은 셀 문단 줄바꿈을 그대로 둔다.
 */
function cellText(c: DocCell): string {
  const parts = [untab(c.text.trim())];
  const walk = (t: DocTable) => {
    const g = new Grid(t);
    for (let r = 0; r < g.rows; r++) {
      const own = g.ownCells(r);
      const texts = own.map((x) => untab(x.text.trim())).filter(Boolean);
      if (texts.length === 1) parts.push(texts[0]!);
      else if (texts.length > 1) parts.push(texts.map((s) => s.replace(/\s*\n\s*/g, ' ')).join('\t'));
      for (const x of own) for (const b of x.blocks) if (b.kind === 'table') walk(b);
    }
  };
  for (const b of c.blocks) if (b.kind === 'table') walk(b);
  return parts.filter(Boolean).join('\n');
}

/** 그 행을 왼→오로 지나는 셀(병합 셀 포함, 중복 제거) */
function rowCells(g: Grid, r: number): DocCell[] {
  const out: DocCell[] = [];
  for (let c = 0; c < g.cols; c++) { const x = g.at(r, c); if (x && out[out.length - 1] !== x) out.push(x); }
  return out;
}

type Draft = Omit<RequirementItem, 'loc'> & { loc: RequirementItem['loc'] };
const newItem = (idText: string, form: RequirementItem['form'], line: number, table?: number): Draft | null => {
  const id = parseReqId(idText);
  if (!id) return null;
  return { id: id.raw, key: id.key, prefix: id.prefix, seq: id.seq, ...(id.sub !== undefined ? { sub: id.sub } : {}), name: untab(id.rest.split('\n')[0] ?? ''), form, loc: { line, ...(table !== undefined ? { table } : {}) } };
};

function extractCards(t: DocTable, out: Draft[]): number {
  const g = new Grid(t);
  let cur: Draft | null = null;
  let made = 0;
  let pending: Partial<Record<Exclude<Field, 'id'>, string>> = {};
  /** 번호를 못 읽은 카드: 다음 번호 라벨까지 오는 값은 버린다(다른 카드로 새지 않게). */
  let skipping = false;
  /** 이 표에서 번호보다 먼저 나오는 칸(예: 분류). 카드가 있는데 이 칸이 또 나오면 다음 카드의 시작이다. */
  const preId = new Set<Field>();
  const complete = (d: Draft) => !!(d.detail || d.definition);
  for (let r = 0; r < g.rows; r++) {
    const cells = rowCells(g, r);
    for (let i = 0; i < cells.length; i++) {
      const lc = cells[i]!;
      if (lc.r !== r && cells[i + 1]?.r !== r) continue; /* 세로 병합으로 이어지는 행에 새 값이 없다 */
      if (!isLabel(lc.text)) {
        // 카드 안에서 행 첫 칸이 짧은 글(모르는 라벨: 산출정보·관련요구사항 등)이고 오른쪽에 값이 있으면 extras
        const t = lc.text.trim();
        if (cur && i === 0 && t && t.length <= 12 && !t.includes('\n') && !parseReqId(t)) {
          let j = 1;
          while (j < cells.length && isEmpty(cells[j]!)) j++;
          const vc = cells[j];
          if (vc && !isLabel(vc.text)) { (cur.extras ??= []).push({ label: t.replace(/\s+/g, ' '), text: cellText(vc) }); i = j; }
        }
        continue;
      }
      let ln = normLabel(lc.text);
      let labelCell = lc;
      let j = i + 1;
      if (GROUP.has(ln)) {
        const nx = cells[j];
        if (nx && isLabel(nx.text) && !GROUP.has(normLabel(nx.text))) { ln = normLabel(nx.text); labelCell = nx; j++; } else ln = '세부내용';
      }
      while (j < cells.length && isEmpty(cells[j]!)) j++;
      const vc = cells[j];
      if (!vc || isLabel(vc.text)) continue;
      i = j;
      if (vc.r !== r) continue; /* 값 셀도 위 행에서 이미 읽은 병합 셀 */
      const val = cellText(vc);
      const f = LABELS[ln];
      // 세로 병합된 라벨의 이어지는 행: 같은 칸에 덧붙인다(다음 카드로 넘기지 않는다)
      if (labelCell.r !== r) {
        if (!skipping && f && f !== 'id') { if (cur) cur[f] = cur[f] ? `${cur[f]}\n${val}` : val; else pending[f] = pending[f] ? `${pending[f]}\n${val}` : val; }
        continue;
      }
      if (f === 'id') {
        const it = newItem(val, 'card', vc.loc.line ?? 0, t.index);
        if (it) for (const k of CONTENT_FIELDS) { const v = pending[k]; if (v && (k !== 'name' || !it.name)) it[k] = v; }
        pending = {};
        if (!it) { cur = null; skipping = true; continue; }
        skipping = false;
        cur = it; out.push(it); made++;
        continue;
      }
      if (skipping) continue;
      if (!f) { if (cur) (cur.extras ??= []).push({ label: lc.text.replace(/\s+/g, ' ').trim(), text: val }); continue; }
      // 번호보다 먼저 나오는 칸이 또 나오거나, 이미 채운 칸이 또 나오고 본문까지 찼으면 다음 카드의 앞부분이다.
      if (cur && (preId.has(f) || (cur[f] && complete(cur)))) cur = null;
      if (!cur) { pending[f] = val; if (made === 0) preId.add(f); continue; }
      if (!cur[f]) cur[f] = val;
      else (cur.extras ??= []).push({ label: lc.text.replace(/\s+/g, ' ').trim(), text: val });
    }
  }
  return made;
}

function extractList(t: DocTable, out: Draft[]): number {
  const g = new Grid(t);
  const cols: Partial<Record<Field, number>> = {};
  let start = -1;
  for (let h = 0; h < Math.min(3, g.rows) && start < 0; h++) {
    const cells = rowCells(g, h);
    const fs = cells.map((c) => LABELS[normLabel(c.text)]);
    if (!fs.includes('id') || fs.filter(Boolean).length < 2) continue;
    cells.forEach((c, i) => { const f = fs[i]; if (f && cols[f] === undefined) cols[f] = c.c; });
    start = h + 1;
  }
  if (start < 0) {
    // 헤더가 없으면 번호 셀이 3개 이상인 열을 번호 열로 본다(요약표)
    for (let c = 0; c < g.cols && start < 0; c++) {
      let n = 0;
      for (let r = 0; r < g.rows; r++) { const x = g.at(r, c); if (x && x.c === c && parseReqId(x.text) && x.text.trim().length <= 60) n++; }
      if (n >= 3) { cols.id = c; start = 0; }
    }
    if (start < 0) return 0;
  }
  let made = 0;
  for (let r = start; r < g.rows; r++) {
    const at = (f: Field) => (cols[f] !== undefined ? g.at(r, cols[f]!) : undefined);
    const idc = at('id');
    if (!idc || idc.r !== r) continue; /* 세로 병합된 번호 셀의 이어지는 행 */
    const it = newItem(idc.text, 'list', idc.loc.line ?? 0, t.index);
    if (!it) continue;
    const nameCell = at('name');
    if (nameCell && nameCell !== idc) it.name = untab(nameCell.text.trim());
    else if (!it.name && cols.name === undefined) {
      const nx = rowCells(g, r).find((x) => x.c > idc.c && !isEmpty(x));
      if (nx) it.name = untab(nx.text.trim().split('\n')[0] ?? '');
    }
    for (const f of ['category', 'definition', 'detail'] as const) { const c = at(f); if (c && c !== idc) it[f] = cellText(c); }
    out.push(it); made++;
  }
  return made;
}

const HEADING = /^\d+(\.\d+)*\.?\s/;
function extractParagraphs(doc: DocModel, out: Draft[]): number {
  let cur: Draft | null = null;
  let made = 0;
  for (const b of doc.blocks) {
    if (b.kind !== 'p') continue;
    const text = untab(b.text.trim());
    if (!text) continue;
    const id = parseReqId(text);
    if (id && id.rest) {
      cur = newItem(text, 'para', b.loc.line ?? 0);
      if (cur) { out.push(cur); made++; }
      continue;
    }
    if (!cur) continue;
    if (HEADING.test(text) && text.length <= 30) { cur = null; continue; }
    const next = cur.detail ? `${cur.detail}\n${text}` : text;
    if (next.length <= PARA_DETAIL_MAX) cur.detail = next;
  }
  return made;
}

export function extractRequirements(doc: DocModel): RequirementSetBody {
  const raw: Draft[] = [];
  let cardTables = 0, listTables = 0;
  const tables = allTables(doc);
  for (const t of tables) {
    if (extractCards(t, raw) > 0) { cardTables++; continue; }
    if (extractList(t, raw) > 0) listTables++;
  }
  let paraItems = 0;
  if (raw.length < 3) paraItems = extractParagraphs(doc, raw);

  // 사전에 없는 접두어는 문서 안에서 2번 이상 나와야 인정(우연히 번호 모양인 셀 배제)
  const prefixCount = new Map<string, number>();
  for (const it of raw) prefixCount.set(it.prefix, (prefixCount.get(it.prefix) ?? 0) + 1);
  const accepted = raw.filter((it) => it.prefix in PREFIX_LABELS || (prefixCount.get(it.prefix) ?? 0) >= 2);

  // 같은 번호 병합: 본문이 긴 쪽(보통 카드) 우선, 빈 칸은 다른 쪽으로 채운다
  const byKey = new Map<string, Draft>();
  for (const it of accepted) {
    const o = byKey.get(it.key);
    if (!o) { byKey.set(it.key, it); continue; }
    const len = (d: Draft) => (d.detail?.length ?? 0) + (d.definition?.length ?? 0);
    const keep = len(it) > len(o) ? it : o, other = keep === it ? o : it;
    for (const f of CONTENT_FIELDS) if (!keep[f] && other[f]) keep[f] = other[f];
    keep.dupCount = (o.dupCount ?? 1) + 1;
    byKey.set(it.key, keep);
  }
  const items: RequirementItem[] = [...byKey.values()].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.seq - b.seq || (a.sub ?? 0) - (b.sub ?? 0));

  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.prefix, (counts.get(it.prefix) ?? 0) + 1);
  const prefixes = [...counts].map(([prefix, count]) => ({ prefix, count, ...(PREFIX_LABELS[prefix] ? { label: PREFIX_LABELS[prefix] } : {}) }))
    .sort((a, b) => b.count - a.count);

  // 번호처럼 생긴 셀인데 항목이 되지 못한 것
  const keys = new Set(items.map((i) => i.key));
  const unparsed = new Set<string>();
  for (const t of tables) for (const c of t.cells) {
    const id = c.text.trim().length <= 20 ? parseReqId(c.text) : null;
    if (id && !id.rest && !keys.has(id.key)) unparsed.add(id.key);
  }

  const warnings: string[] = [];
  const noName = items.filter((i) => !i.name).length;
  if (doc.format === 'pdf') warnings.push('PDF는 표 구조를 읽지 못해 요구사항 일부만 인식했을 수 있어요. HWP 원본이 있으면 그 파일이 더 정확해요.');
  if (unparsed.size) warnings.push(`번호처럼 보이지만 요구사항으로 인식하지 못한 칸 ${unparsed.size}개`);
  if (noName) warnings.push(`명칭을 찾지 못한 요구사항 ${noName}개`);
  const quality = items.length === 0 ? 'none'
    : items.length < 5 || unparsed.size > items.length * 0.2 || noName > items.length * 0.3 ? 'partial' : 'good';

  return { items, prefixes, quality, warnings, stats: { tables: tables.length, cardTables, listTables, paraItems, idLikeUnparsed: unparsed.size } };
}
