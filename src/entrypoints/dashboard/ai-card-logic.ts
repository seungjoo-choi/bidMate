export interface ModelInfo { id: string; displayName?: string }

/** permissions.request / contains 에 넘기는 origin 패턴. 끝 슬래시는 정규화한다. */
export function originPattern(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/+$/, '')}/*`;
}

/** 저장된 키의 끝 4자리 표시. 키가 4자 이하면 전체를 가리지 않고 끝 4자리 규칙만 적용한다. */
export function keyTail(key: string): string {
  return `****${key.slice(-4)}`;
}

/** 모델 목록으로 select 옵션을 만든다. 현재값이 목록에 없으면 맨 위에 덧붙여 선택 상태가 사라지지 않게 한다. */
export function modelOptions(models: ModelInfo[], current: string): Array<{ value: string; label: string }> {
  const opts = models.map((m) => ({ value: m.id, label: m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id }));
  if (current && !models.some((m) => m.id === current)) opts.unshift({ value: current, label: `${current} (목록에 없음)` });
  return opts;
}

/** 목록이 있을 때만 유효성을 따진다. 목록이 없으면(테스트 전) 비어 있지 않은 값이면 유효. */
export function isModelValid(models: ModelInfo[], value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return models.length === 0 || models.some((m) => m.id === v);
}

/** 반자동 붙여넣기 상한 안내용 "약 N자". */
export function formatChars(n: number): string {
  return `약 ${n.toLocaleString('ko-KR')}자`;
}

/** secrets.ai[provider]를 병합 저장한 새 secrets 객체. 기존 g2bServiceKey 등 다른 키는 보존한다. */
export function mergeAiKey(secrets: Record<string, unknown> | undefined, provider: string, key: string): Record<string, unknown> {
  const ai = (secrets?.ai ?? {}) as Record<string, string>;
  return { ...secrets, ai: { ...ai, [provider]: key } };
}

/** secrets.ai 를 화면 상태용 끝 4자리 표시값으로 바꾼다. 원문은 결과에 남기지 않는다. */
export function keyTails(secretsAi: Partial<Record<string, string>> | undefined): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const [p, v] of Object.entries(secretsAi ?? {})) if (v) out[p] = keyTail(v);
  return out;
}
