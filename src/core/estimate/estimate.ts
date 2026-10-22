import type { Notice } from '../types/notice';
import type { Extraction } from '../types/extraction';
import type { Settings, CreditKind } from '../types/settings';
import { CREDIT_KIND_LABEL } from '../types/company';
import { ESTIMATE_FIELD, ESTIMATE_KEYS, type EstimateEntry, type EstimateFile, type EstimateKey } from '../types/estimate';

export type MaxState = 'known' | 'review' | 'not_applicable' | 'missing';
export interface EstimateRow {
  key: EstimateKey; label: string;
  max: number | null; maxState: MaxState;
  score: number | null; note: string | null;
  evidence: { file: string; location: string; text: string } | null;
  hint: string | null;
  overMax: boolean;
}
export interface EstimateSummary { rows: EstimateRow[]; filled: number; applicable: number; total: number | null; maxTotal: number | null; allKnown: boolean }

const LABEL: Record<EstimateKey, string> = { management: '경영상태', credibility: '대외신인도', performance: '수행실적' };
const NOTE_MAX = 200;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function maxOf(notice: Notice, extraction: Extraction | null, key: EstimateKey): { max: number | null; state: MaxState } {
  const field = ESTIMATE_FIELD[key];
  const item = extraction?.items[field];
  const f = notice.evaluation[field];
  const byValue = (v: unknown): { max: number | null; state: MaxState } => (isNum(v) ? { max: v, state: 'known' } : { max: null, state: 'not_applicable' });
  if (item?.userEdited !== undefined) return byValue(item.userEdited.value);
  if (f.status === 'user_edited' || f.status === 'verified') return byValue(f.value);
  if (item?.status === 'verified' && item.value === null) return { max: null, state: 'not_applicable' };
  if (isNum(f.value)) return { max: f.value, state: 'review' };
  return { max: null, state: 'missing' };
}

function hintOf(key: EstimateKey, company: Settings['company']): string | null {
  if (key === 'management') {
    const parts = (Object.keys(CREDIT_KIND_LABEL) as CreditKind[]).flatMap((k) => {
      const c = company.credit?.[k];
      if (!c?.grade) return [];
      return [`${CREDIT_KIND_LABEL[k]} ${c.grade}${c.evaluatedAt ? ` (${c.evaluatedAt})` : ''}`];
    });
    return parts.length ? parts.join(', ') : null;
  }
  if (key === 'credibility') return company.attributes?.length ? company.attributes.join(', ') : null;
  return null;
}

export function estimateRows(notice: Notice, extraction: Extraction | null, file: EstimateFile | null, company: Settings['company']): EstimateSummary {
  const rows: EstimateRow[] = ESTIMATE_KEYS.map((key) => {
    const { max, state } = maxOf(notice, extraction, key);
    const entry = state === 'not_applicable' ? undefined : file?.items[key];
    const ev = extraction?.items[ESTIMATE_FIELD[key]]?.evidence;
    const score = entry ? entry.score : null;
    return {
      key, label: LABEL[key], max, maxState: state,
      score, note: entry?.note ?? null,
      evidence: ev ? { file: ev.sourceFile, location: ev.location, text: ev.evidence } : null,
      hint: hintOf(key, company),
      overMax: score !== null && max !== null && score > max,
    };
  });
  const scored = rows.filter((r) => r.score !== null);
  const knownMax = rows.filter((r) => r.maxState === 'known');
  const applicableRows = rows.filter((r) => r.maxState !== 'not_applicable');
  return {
    rows,
    filled: scored.length,
    applicable: applicableRows.length,
    total: scored.length ? round2(scored.reduce((a, r) => a + (r.score as number), 0)) : null,
    maxTotal: knownMax.length ? round2(knownMax.reduce((a, r) => a + (r.max as number), 0)) : null,
    allKnown: applicableRows.every((r) => r.maxState === 'known'),
  };
}

/** 입력 점수 검증. 실패 시 code 'INVALID_VALUE' Error. 소수 2자리로 반올림한 값을 돌려준다. */
export function validateScore(score: unknown, max: number | null): number {
  if (!isNum(score)) throw err('INVALID_VALUE', '점수는 숫자여야 합니다.');
  if (score < 0) throw err('INVALID_VALUE', '점수는 0 이상이어야 합니다.');
  const v = round2(score);
  if (max !== null && v > max) throw err('INVALID_VALUE', `배점 ${max}점을 넘을 수 없습니다.`);
  return v;
}

const emptyFile = (noticeId: string): EstimateFile => ({ schemaVersion: 1, noticeId, items: {}, updatedAt: new Date().toISOString() });

/** 저장 파일 정규화. 손상 시 빈 파일, 손상된 항목은 버린다. */
export function normalizeEstimate(raw: unknown, noticeId: string): EstimateFile {
  if (!raw || typeof raw !== 'object') return emptyFile(noticeId);
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1 || !o.items || typeof o.items !== 'object') return emptyFile(noticeId);
  const items: EstimateFile['items'] = {};
  for (const key of ESTIMATE_KEYS) {
    const e = (o.items as Record<string, unknown>)[key] as Partial<EstimateEntry> | undefined;
    if (!e || typeof e !== 'object' || !isNum(e.score) || e.score < 0 || typeof e.updatedAt !== 'string') continue;
    const entry: EstimateEntry = { score: round2(e.score), updatedAt: e.updatedAt };
    if (typeof e.note === 'string' && e.note) entry.note = e.note.slice(0, NOTE_MAX);
    items[key] = entry;
  }
  return { schemaVersion: 1, noticeId, items, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString() };
}
