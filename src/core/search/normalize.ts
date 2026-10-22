import { displayLine } from '../doc/text-blocks';
import { SEARCH_MIN_QUERY_CHARS } from './constants';
import type { SearchQuery } from './types';

const SKIP_RE = /[\s|​-‍⁠﻿]/;
/** 앞 글자와 합쳐질 수 있는 조각(결합 문자, 한글 자모 중성·종성). NFC를 묶음 단위로 하기 위해 쓴다. */
const JOIN_RE = /[\p{M}ᅡ-ᇿ]/u;

/**
 * 검색용 정규화. 처리 순서: displayLine(태그 제거) → `|`·공백·zero-width 제거 → `：`→`:` → NFC → 소문자.
 * `map[i]`는 norm[i]가 온 displayLine 문자열의 열(NFC로 합쳐진 글자는 첫 조각의 열), `ends[i]`는 그 묶음의 끝 열(배타).
 */
export function normalizeLine(line: string): { norm: string; map: number[]; ends: number[] } {
  const d = displayLine(line);
  let norm = '';
  const map: number[] = [];
  const ends: number[] = [];
  let group = '';
  let groupCol = 0;
  let groupEnd = 0;
  const flush = () => {
    if (!group) return;
    for (const ch of group.normalize('NFC').toLowerCase()) {
      norm += ch;
      for (let k = 0; k < ch.length; k++) { map.push(groupCol); ends.push(groupEnd); }
    }
    group = '';
  };
  for (let i = 0; i < d.length; i++) {
    let ch = d[i]!;
    if (SKIP_RE.test(ch)) continue;
    if (ch === '：') ch = ':';
    if (group && JOIN_RE.test(ch)) { group += ch; groupEnd = i + 1; continue; }
    flush();
    group = ch;
    groupCol = i;
    groupEnd = i + 1;
  }
  flush();
  return { norm, map, ends };
}

/** 질의 분해. `"…"`는 구문, 나머지는 공백 항. 정규화 후 2자 미만 항은 버리고, 남은 것이 없으면 terms·phrases 모두 빈 배열. */
export function parseQuery(raw: string): SearchQuery {
  const phrases: string[] = [];
  const rest = raw.replace(/"([^"]*)"/g, (_m, p: string) => {
    const n = normalizeLine(p).norm;
    if (n.length >= SEARCH_MIN_QUERY_CHARS) phrases.push(n);
    return ' ';
  });
  const terms: string[] = [];
  // 짝 없는 따옴표는 지우고 일반 항으로 처리한다.
  for (const t of rest.replace(/"/g, '').split(/\s+/)) {
    const n = normalizeLine(t).norm;
    if (n.length >= SEARCH_MIN_QUERY_CHARS) terms.push(n);
  }
  return { terms, phrases, raw };
}
