/** "2026-10-22 14:00:00", "2026/10/21 18:00", "2026-10-21 18:00" → "+09:00" ISO. 해석 불가면 null. */
export function toIsoKst(s: string): string | null {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+09:00` : null;
}

/** 문서 날짜 원문("2024/10/08 09:30", "2024. 3. 7.(목) 13:30")을 ISO(+09:00)로 바꾼다. 날짜·시각 중 하나라도 없거나 범위를 벗어나면 null. */
export function docDateToIso(text: string): string | null {
  const t = text;
  const d = /(\d{4})\s*(?:[./-]\s*(\d{1,2})\s*[./-]|년\s*(\d{1,2})\s*월)\s*(\d{1,2})/.exec(t);
  if (!d) return null;
  const tm = /(\d{1,2}):(\d{2})/.exec(t.slice(d.index + d[0].length));
  if (!tm) return null;
  const [y, mo, da, hh, mi] = [Number(d[1]), Number(d[2] ?? d[3]), Number(d[4]), Number(tm[1]), Number(tm[2])];
  if (hh > 23 || mi > 59) return null;
  const cal = new Date(Date.UTC(y, mo - 1, da)); // 실제 달력 날짜만(2024.02.30 거부)
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== da) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return toIsoKst(`${d[1]}-${p2(mo)}-${p2(da)} ${p2(hh)}:${p2(mi)}`);
}
