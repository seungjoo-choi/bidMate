import { locateQuote } from '../ai/verify';
import type { AskCitation, AskConflict } from '../types/search';
import type { RawAskCitation, RawAskConflict } from './ask-prompt';

export interface AskVerifyDoc { id: string; name: string; textPath: string; text: string }
export type LocatedCitation = AskCitation;

/** 정확 일치 또는 경로 구분자 경계에서 끝나는 이름이면 확정, 그 외 endsWith는 loose(경고 대상). */
const findByName = (docs: AskVerifyDoc[], name: string): { doc: AskVerifyDoc; loose: boolean } | undefined => {
  const strict = docs.find((d) => d.name === name || d.name.endsWith(`/${name}`) || d.name.endsWith('\\' + name));
  if (strict) return { doc: strict, loose: false };
  const loose = docs.find((d) => d.name.endsWith(name));
  return loose ? { doc: loose, loose: true } : undefined;
};

/** 인용문 위치만 찾는다(값은 검증하지 않는다). 이름이 가리키는 파일 → 못 찾으면 다른 문서 순서대로. 다른 문서에서 찾으면 warnings에 남긴다. */
function locate(docs: AskVerifyDoc[], file: string | null, quote: string, label: string, warnings?: string[]): { located: AskCitation['located']; partial: boolean } {
  const found = file ? findByName(docs, file) : undefined;
  const named = found?.doc;
  if (found?.loose) warnings?.push(`${label}: 파일 이름(${file})이 정확히 일치하지 않아 ${found.doc.name}로 보고 찾았습니다.`);
  const hit = (d: AskVerifyDoc, loc: NonNullable<ReturnType<typeof locateQuote>>) =>
    ({ located: { docId: d.id, textPath: d.textPath, line: loc.line, endLine: loc.endLine, page: loc.page }, partial: loc.partial });
  if (named) {
    const loc = locateQuote(named.text, quote);
    if (loc) return hit(named, loc);
  }
  for (const d of docs) {
    if (d === named) continue;
    const loc = locateQuote(d.text, quote);
    if (loc) {
      if (file) warnings?.push(`${label}: 인용문을 AI가 알려준 파일(${file})이 아니라 ${d.name}에서 찾았습니다.`);
      return hit(d, loc);
    }
  }
  return { located: null, partial: false };
}

export function locateCitations(citations: RawAskCitation[], docs: AskVerifyDoc[], warnings?: string[]): LocatedCitation[] {
  return citations.map((c, i) => {
    const { located, partial } = locate(docs, c.file, c.quote, `근거 ${i + 1}`, warnings);
    return { ...c, located, ...(located && partial ? { partial: true } : {}) };
  });
}

export function locateConflicts(conflicts: RawAskConflict[], docs: AskVerifyDoc[], warnings?: string[]): AskConflict[] {
  return conflicts.map((c) => ({
    topic: c.topic,
    values: c.values.map((v) => {
      const { located, partial } = locate(docs, v.file || null, v.quote, `상충 ${c.topic}`, warnings);
      return { ...v, located, ...(located && partial ? { partial: true } : {}) };
    }),
  }));
}
