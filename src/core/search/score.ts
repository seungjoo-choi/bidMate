import { ASK_KEEP_WORDS, ASK_STOPWORDS } from './constants';
import { normalizeLine } from './normalize';

export interface QuestionTerms { terms: string[]; bigrams: Set<string> }

const PUNCT_RE = /[?？!！.,;:'"()[\]]/g;
const STOP_DESC = [...ASK_STOPWORDS].sort((a, b) => b.length - a.length);
const MIN_TERM = 2;
/** 머리글로 보는 짧은 줄 길이(정규화 후). */
const HEAD_MAX_CHARS = 30;

const bigramsOf = (norm: string): string[] => {
  const cs = Array.from(norm);
  const out: string[] = [];
  for (let i = 0; i + 1 < cs.length; i++) out.push(cs[i]! + cs[i + 1]!);
  return out;
};

/** 질문 분해. 공백 항에서 끝의 조사·의문 어미(ASK_STOPWORDS)를 떼고 2자 미만·불용어 항은 버린다. bigram은 질문 전체(정규화) 기준. */
export function questionTerms(q: string): QuestionTerms {
  const terms: string[] = [];
  for (const raw of q.split(/\s+/)) {
    let t = normalizeLine(raw.replace(PUNCT_RE, '')).norm;
    if (!t || STOP_DESC.includes(t)) continue;
    for (;;) {
      if (ASK_KEEP_WORDS.includes(t)) break;
      // 남는 길이 2자 이상일 때만 뗀다(기간은 → 기간). 끝 글자가 조사처럼 보이는 낱말은 ASK_KEEP_WORDS로 보호한다.
      const suf = STOP_DESC.find((s) => t.endsWith(s) && t.length - s.length >= MIN_TERM);
      if (!suf) break;
      t = t.slice(0, t.length - suf.length);
    }
    if (t.length >= MIN_TERM && !STOP_DESC.includes(t) && !terms.includes(t)) terms.push(t);
  }
  const bigrams = new Set(bigramsOf(normalizeLine(q.replace(PUNCT_RE, '')).norm));
  return { terms, bigrams };
}

/** 점수 = 3 × (등장한 항 수) + (bigram 교집합 크기) + 짧은 줄 머리글 가산 1(다른 점수가 있을 때만). 0이면 후보가 아니다. */
export function scoreUnit(norm: string, qt: QuestionTerms): number {
  let score = 0;
  for (const t of qt.terms) if (norm.includes(t)) score += 3;
  if (qt.bigrams.size) {
    const seen = new Set<string>();
    for (const b of bigramsOf(norm)) if (qt.bigrams.has(b) && !seen.has(b)) { seen.add(b); score++; }
  }
  if (score > 0 && norm.length <= HEAD_MAX_CHARS) score += 1;
  return score;
}
