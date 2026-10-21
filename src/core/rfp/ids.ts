/** 요구사항 고유번호 해석. "SFR-01", "PER－003", "SER_2-1 사용자 인증"(번호+명칭 한 셀) 등. */
export interface ParsedReqId { prefix: string; seq: number; sub?: number; key: string; raw: string; rest: string }

const DASHES = /[－–—‐‑‒]/g;
const ID_RE = /^([A-Z]{2,6})\s*[-_]\s*(\d{1,4})(?:\s*[-.]\s*(\d{1,3}))?(?![\d])(.*)$/s;

export function parseReqId(text: string): ParsedReqId | null {
  const t = text.normalize('NFC').trim().replace(DASHES, '-');
  const m = ID_RE.exec(t);
  if (!m) return null;
  const prefix = m[1]!;
  const seq = Number(m[2]);
  if (seq === 0) return null; /* "SER-00 | 13" 같은 분류 총괄표의 번호 형식 표기 */
  const sub = m[3] !== undefined ? Number(m[3]) : undefined;
  const rest = m[4]!.replace(/^[\s:：.)\]]+/, '').trim();
  const key = `${prefix}-${String(seq).padStart(3, '0')}${sub !== undefined ? `-${String(sub).padStart(2, '0')}` : ''}`;
  const rawEnd = t.length - m[4]!.length;
  return { prefix, seq, sub, key, raw: t.slice(0, rawEnd).replace(/\s+/g, ''), rest };
}

/** 행정기관 SW사업 제안요청서 가이드의 접두어(표시용). 사전에 없어도 문서 안에서 반복되면 인정한다. */
export const PREFIX_LABELS: Record<string, string> = {
  SFR: '기능', FUN: '기능', PER: '성능', SER: '보안', DAR: '데이터', INR: '인터페이스', INT: '인터페이스',
  TER: '테스트', COR: '제약사항', QUR: '품질', CSR: '컨설팅', PMR: '프로젝트 관리', PSR: '프로젝트 지원',
  ECR: '장비구성', OPR: '운영', RSR: '사전준비',
};
