import { newId } from '../../core/model/ids';
import { normalizePerformance, validatePerformanceInput } from '../../core/performances/normalize';
import type {
  PerformanceImportPlan, PerformanceImportResult, PerformanceImportSummary, PerformanceInput, PerformanceRecord, PerformancesSnapshot,
} from '../../core/types/performance';
import type { IFileStore } from '../file-store/types';
import { loadList, saveList, withConfigLock } from './config-store';

export interface ConfigOpts { now?: () => Date }

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const nowOf = (opts: ConfigOpts): Date => (opts.now ?? (() => new Date()))();

/** endAt 내림차순(없는 것 맨 위), 같으면 startAt 내림차순. */
function sortItems(items: PerformanceRecord[]): PerformanceRecord[] {
  return [...items].sort((a, b) => {
    const ea = a.endAt ?? '9999-99-99';
    const eb = b.endAt ?? '9999-99-99';
    if (ea !== eb) return ea < eb ? 1 : -1;
    return a.startAt === b.startAt ? 0 : a.startAt < b.startAt ? 1 : -1;
  });
}

async function loadState(store: IFileStore, now: Date): Promise<PerformancesSnapshot> {
  let skipped = 0;
  const r = await loadList<PerformanceRecord>(store, 'performances', (raw, fileAt) => {
    const item = normalizePerformance(raw, fileAt);
    if (!item) skipped++;
    return { item, warnings: [] };
  }, now);
  const warnings = [...r.warnings];
  if (skipped > 0) warnings.push(`형식이 맞지 않는 실적 ${skipped}건을 건너뛰었습니다`);
  return { items: r.items, warnings };
}

export async function listPerformances(store: IFileStore, opts: ConfigOpts = {}): Promise<PerformancesSnapshot> {
  const s = await loadState(store, nowOf(opts));
  return { items: sortItems(s.items), warnings: s.warnings };
}

export function savePerformance(store: IFileStore, input: PerformanceInput, opts: ConfigOpts = {}): Promise<PerformancesSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const s = await loadState(store, now);
    const fields = validatePerformanceInput(input);
    const id = input?.id;
    let items: PerformanceRecord[];
    if (typeof id === 'string' && id !== '') {
      const idx = s.items.findIndex((p) => p.id === id);
      if (idx < 0) throw err('NOT_FOUND', '실적을 찾을 수 없습니다.');
      items = [...s.items];
      items[idx] = { ...fields, id, source: s.items[idx]!.source, updatedAt: now.toISOString() };
    } else {
      items = [...s.items, { ...fields, id: newId('perf'), source: input.source ?? 'manual', updatedAt: now.toISOString() }];
    }
    items = sortItems(items);
    await saveList(store, 'performances', items, now);
    return { items, warnings: s.warnings };
  });
}

export function deletePerformance(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<PerformancesSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const s = await loadState(store, now);
    if (!s.items.some((p) => p.id === id)) throw err('NOT_FOUND', '실적을 찾을 수 없습니다.');
    const items = sortItems(s.items.filter((p) => p.id !== id));
    await saveList(store, 'performances', items, now);
    return { items, warnings: s.warnings };
  });
}

export function importPerformances(store: IFileStore, plan: PerformanceImportPlan, opts: ConfigOpts = {}): Promise<PerformanceImportResult> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    if (!plan || !Array.isArray(plan.add) || (plan.mode !== 'append' && plan.mode !== 'replace')) {
      throw err('INVALID_VALUE', '가져오기 계획 형식이 올바르지 않습니다.');
    }
    const s = await loadState(store, now);
    const summary: PerformanceImportSummary = { added: 0, removed: 0, skipped: [] };
    let items = s.items;
    let changed = false;
    if (plan.mode === 'replace') {
      summary.removed = items.length;
      items = [];
      changed = summary.removed > 0;
    }
    const nowIso = now.toISOString();
    plan.add.forEach((a, i) => {
      try {
        const fields = validatePerformanceInput(a);
        items.push({ ...fields, id: newId('perf'), source: 'excel', updatedAt: nowIso });
        summary.added++;
        changed = true;
      } catch (e) {
        summary.skipped.push({ row: i + 1, reason: e instanceof Error ? e.message : String(e) });
      }
    });
    items = sortItems(items);
    if (changed) await saveList(store, 'performances', items, now);
    return { items, warnings: s.warnings, summary };
  });
}
