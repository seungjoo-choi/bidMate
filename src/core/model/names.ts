import { sanitizeSegment } from './sanitize';

export interface NamePrefixSetting { enabled: boolean; text: string }

/** 저장 파일명 앞에 붙일 태그. 꺼져 있거나 문구가 비면 undefined. 파일명에 못 쓰는 문자와 `..`은 뗀다. */
export function activeNamePrefix(p: NamePrefixSetting | undefined): string | undefined {
  if (!p?.enabled) return undefined;
  const t = p.text.trim().replace(/\.{2,}/g, '.');
  if (!t) return undefined;
  const s = sanitizeSegment(t, 40);
  // 금지 문자만 있던 문구는 sanitizeSegment가 '_'로 바꾼다. 그런 태그는 붙이지 않는다.
  return s === '_' && t !== '_' ? undefined : s;
}

/** `태그 이름` 꼴로 붙인다. 이미 태그로 시작하면 그대로 둔다. */
export function withNamePrefix(name: string, prefix: string | undefined): string {
  if (!prefix || name.startsWith(prefix)) return name;
  return `${prefix} ${name}`;
}

/** 앞의 태그를 뗀다. 원래 이름이 공백 없이 태그로 시작한 경우(`[태그]a.hwp`)도 뗀다. */
export function withoutNamePrefix(name: string, prefix: string | undefined): string {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length).trimStart() : name;
}

/** 대소문자 무시 비교로 충돌을 피해 `name (2).ext` 형식 이름을 반환한다. */
export function uniqueName(name: string, taken: Set<string>): string {
  const lowered = new Set(Array.from(taken, (t) => t.toLowerCase()));
  if (!lowered.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!lowered.has(candidate.toLowerCase())) return candidate;
  }
}
