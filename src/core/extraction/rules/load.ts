import type { Rule, RuleSet } from './schema';
import { synonymError, validateRule } from './schema';
import defaultRulesJson from './default-rules.json';

export const DEFAULT_RULES = defaultRulesJson as unknown as RuleSet;
export type LoadedRules = RuleSet & { warnings: string[] };

function warnOverlap(base: LoadedRules): void {
  const byTarget = new Map<string, Set<string>>();
  for (const r of base.rules) {
    if (r.strategy !== 'table-score' && r.strategy !== 'inline-score') continue;
    const terms = base.synonyms[r.label];
    if (!terms) continue;
    const set = byTarget.get(r.target) ?? new Set<string>();
    for (const t of terms) set.add(t.replace(/\s+/g, ''));
    byTarget.set(r.target, set);
  }
  const targets = [...byTarget.keys()];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i] as string, b = targets[j] as string;
      for (const term of byTarget.get(a) as Set<string>) {
        if ((byTarget.get(b) as Set<string>).has(term)) {
          base.warnings.push(`동의어 겹침: ${a}/${b}에 '${term}'이 모두 있어 같은 값이 두 항목에 들어갈 수 있음`);
        }
      }
    }
  }
}

/** 기본 규칙에 사용자 규칙 JSON({version?, synonyms?, rules?})을 병합한다(규칙은 id 기준 덮어쓰기/추가, 동의어는 키 단위 덮어쓰기).
 *  틀린 규칙/동의어는 그 항목만 버리고 warnings에 남긴다. 파일 읽기는 호출자 몫. */
export function loadRules(userJson?: unknown): LoadedRules {
  const base: LoadedRules = {
    version: DEFAULT_RULES.version,
    synonyms: { ...DEFAULT_RULES.synonyms },
    rules: [...DEFAULT_RULES.rules],
    warnings: [],
  };
  if (userJson === undefined || userJson === null) return base;
  if (typeof userJson !== 'object' || Array.isArray(userJson)) {
    base.warnings.push('사용자 규칙 무시: 규칙 JSON이 객체가 아님');
    return base;
  }
  const u = userJson as Record<string, unknown>;
  const warn = (m: string) => base.warnings.push(`사용자 규칙 무시: ${m}`);

  if (u.synonyms !== undefined) {
    if (typeof u.synonyms !== 'object' || u.synonyms === null || Array.isArray(u.synonyms)) warn('synonyms 오류');
    else {
      for (const [k, v] of Object.entries(u.synonyms)) {
        const e = synonymError(k, v);
        if (e) warn(e);
        else base.synonyms[k] = v as string[];
      }
    }
  }
  if (u.rules !== undefined && !Array.isArray(u.rules)) warn('rules가 배열이 아님');
  else {
    for (const r of (u.rules as unknown[] | undefined) ?? []) {
      const errs = validateRule(r, base.synonyms, true);
      if (errs.length) { errs.forEach(warn); continue; }
      const rule = r as Rule;
      const i = base.rules.findIndex((x) => x.id === rule.id);
      if (i >= 0) base.rules[i] = rule;
      else base.rules.push(rule);
    }
  }
  warnOverlap(base);
  base.version = `${base.version}+${typeof u.version === 'string' && u.version ? u.version : 'user'}`;
  return base;
}
