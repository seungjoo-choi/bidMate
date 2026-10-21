// RFP 비교 진입 화면의 순수 로직(추천 정렬, 업로드 검사, base64, 표시용 계산).
import { dice } from '../../../core/rfp/normalize';
import type { IndexEntry } from '../../../core/types/index-file';
import type { RequirementSet, RfpDocCandidate, RfpDocRef, RfpQuality } from '../../../core/types/rfp';

export const UPLOAD_EXTS = ['hwp', 'hwpx', 'pdf', 'docx'] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SIMILAR_MIN = 0.3;

export type UploadCheck = { ok: true } | { ok: false; reason: string };

/** 확장자(hwp/hwpx/pdf/docx)와 20MB 제한을 검사한다. */
export function checkUploadFile(name: string, size: number): UploadCheck {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!(UPLOAD_EXTS as readonly string[]).includes(ext)) return { ok: false, reason: 'HWP·HWPX·DOCX·PDF 파일만 올릴 수 있어요.' };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: '20MB보다 큰 파일은 올릴 수 없어요.' };
  if (size <= 0) return { ok: false, reason: '빈 파일이에요.' };
  return { ok: true };
}

/** 청크로 나눠 String.fromCharCode + btoa (큰 파일에서 인자 개수 한도를 넘지 않게). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 기관 기준값: 수요기관이 있으면 수요기관, 없으면 공고(발주)기관. */
export const orgOf = (e: IndexEntry): string => e.demandOrg || e.orderingOrg;

/** 화면용 기관 문구: 수요기관이 달라야 "수요 … · 공고 …", 아니면 하나만. */
export function orgLabel(e: IndexEntry): string {
  return e.demandOrg && e.demandOrg !== e.orderingOrg ? `수요 ${e.demandOrg} · 공고 ${e.orderingOrg}` : orgOf(e);
}

/** sameName: 연도·흔한 사업 용어를 뺀 핵심 사업명이 겹침(예: 둘 다 "축산물원패스") */
export interface Recommended { entry: IndexEntry; sameOrg: boolean; sameName: boolean; sim: number }

// 공고명마다 붙는 말. 이것을 빼야 "축산물원패스 기능 고도화" ↔ "축산물원패스 유지관리"가 같은 사업으로 보인다.
const GENERIC_WORDS = ['유지보수', '유지관리', '고도화', '활성화', '재구축', '차세대', '시스템', '정보화', '사업', '용역', '구축', '기능', '개선', '운영', '개발', '위탁', '및'];
const NAME_MIN = 3; /* 핵심 이름에서 겹쳐야 하는 최소 글자 수 */
const NAME_RATIO = 0.8; /* 짧은 쪽 핵심 이름의 이 비율 이상이 겹치면 같은 사업명 */

/** 공고명의 핵심 사업명: 연도·차수·숫자·문장부호·흔한 사업 용어·공백 제거, 소문자. */
export function coreTitle(title: string): string {
  let t = title.normalize('NFC').toLowerCase()
    .replace(/(19|20)\d{2}\s*년?(도)?/g, ' ').replace(/\d+\s*(차|단계|년차)/g, ' ').replace(/\d+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  for (const w of GENERIC_WORDS) t = t.split(w).join(' ');
  return t.replace(/\s+/g, '');
}

/** 두 문자열의 가장 긴 공통 부분 문자열 길이 */
function longestCommon(a: string, b: string): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j]! > best) best = prev[j]!;
      diag = tmp;
    }
  }
  return best;
}

/** 공고명 유사도(0..1)와 같은 사업명 여부. 핵심 사업명끼리 bigram 유사도와 공통 부분 비율 중 큰 값. */
export function titleSimilarity(a: string, b: string): { sim: number; sameName: boolean } {
  const ca = coreTitle(a), cb = coreTitle(b);
  if (ca.length < 2 || cb.length < 2) return { sim: dice(a, b), sameName: false };
  const lcs = longestCommon(ca, cb);
  const ratio = lcs >= NAME_MIN ? lcs / Math.min(ca.length, cb.length) : 0;
  return { sim: Math.max(dice(ca, cb), ratio), sameName: ratio >= NAME_RATIO };
}

/**
 * 다른 칸의 공고를 기준으로 추천 목록을 만든다. 같은 사업명·같은 기관·공고명 유사도 ≥ 0.3 중 하나라도 맞으면 포함.
 * 정렬: 같은 사업명 → 같은 기관 → 유사도.
 */
export function recommend(entries: IndexEntry[], base: { noticeId: string; title: string; org: string } | undefined): Recommended[] {
  if (!base) return [];
  const out: Recommended[] = [];
  for (const entry of entries) {
    if (entry.noticeId === base.noticeId) continue;
    const sameOrg = !!base.org && orgOf(entry) === base.org;
    const { sim, sameName } = titleSimilarity(base.title, entry.title);
    if (sameName || sameOrg || sim >= SIMILAR_MIN) out.push({ entry, sameOrg, sameName, sim });
  }
  return out.sort((a, b) => Number(b.sameName) - Number(a.sameName) || Number(b.sameOrg) - Number(a.sameOrg) || b.sim - a.sim);
}

/** 제목·공고번호·기관(수요기관 포함) 부분 일치 필터(대소문자·공백 무시). */
export function filterEntries(entries: IndexEntry[], query: string): IndexEntry[] {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => `${e.title}${e.noticeNo}${e.orderingOrg}${e.demandOrg ?? ''}`.replace(/\s+/g, '').toLowerCase().includes(q));
}

/** 공고 연도: 나라장터 공고번호 앞자리(R26… → 2026), 아니면 수집일 연도. */
export function noticeYear(e: IndexEntry): number | null {
  const m = /^[A-Z](\d{2})/.exec(e.noticeNo ?? '');
  if (m) return 2000 + Number(m[1]);
  const y = Number((e.collectedAt ?? '').slice(0, 4));
  return y > 2000 ? y : null;
}

/** 선택지와 개수. 연도는 최신순, 기관은 많은 순(같으면 가나다). */
export function yearFacets(entries: IndexEntry[]): Array<{ year: number; count: number }> {
  const m = new Map<number, number>();
  for (const e of entries) { const y = noticeYear(e); if (y) m.set(y, (m.get(y) ?? 0) + 1); }
  return [...m].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
}
export function orgFacets(entries: IndexEntry[]): Array<{ org: string; count: number }> {
  const m = new Map<string, number>();
  for (const e of entries) { const o = orgOf(e); if (o) m.set(o, (m.get(o) ?? 0) + 1); }
  return [...m].map(([org, count]) => ({ org, count })).sort((a, b) => b.count - a.count || a.org.localeCompare(b.org, 'ko'));
}
/** 연도·기관 필터('' = 전체) */
export function filterFacets(entries: IndexEntry[], f: { year: string; org: string }): IndexEntry[] {
  return entries.filter((e) => (!f.year || String(noticeYear(e)) === f.year) && (!f.org || orgOf(e) === f.org));
}

/** 후보 중 기본 선택: rfp 우선, 없으면 첫 후보. */
export function defaultCandidate(cands: RfpDocCandidate[]): RfpDocCandidate | undefined {
  return cands.find((c) => c.docKind === 'rfp') ?? cands[0];
}

export function sameRef(a: RfpDocRef | undefined, b: RfpDocRef | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind === 'upload') return b.kind === 'upload' && a.uploadId === b.uploadId;
  return b.kind === 'notice' && a.noticeId === b.noticeId && a.attachmentId === b.attachmentId && (a.innerPath ?? '') === (b.innerPath ?? '');
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export const QUALITY_LABEL: Record<RfpQuality, string> = { good: '잘 읽었어요', partial: '일부만 인식', none: '요구사항 없음' };

export const extLabel = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toUpperCase();
};

/** 비교 가능 여부: 요구사항 1개 이상(good·partial)만. */
export const slotUsable = (set: RequirementSet | undefined): boolean => !!set && set.quality !== 'none' && set.items.length > 0;
