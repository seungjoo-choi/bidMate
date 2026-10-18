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
