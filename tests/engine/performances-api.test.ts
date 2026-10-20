import { describe, expect, it } from 'vitest';
import type { PerformanceInput } from '../../src/core/types/performance';
import { CONFIG_PATHS } from '../../src/engine/config/config-store';
import { deletePerformance, importPerformances, listPerformances, savePerformance } from '../../src/engine/config/performances-api';
import { MemoryStore } from '../helpers/memory-store';

const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => e.code as string);
const inp = (o: Partial<PerformanceInput> = {}): PerformanceInput => ({ title: 'A사업', client: '공단', amount: 1000, startAt: '2024-01-01', endAt: '2024-06-30', ...o });

describe('performances-api', () => {
  it('추가하면 id, source manual, updatedAt이 채워진다', async () => {
    const mem = new MemoryStore();
    const snap = await savePerformance(mem, inp(), { now: () => new Date('2026-01-01T00:00:00Z') });
    const p = snap.items[0]!;
    expect(p.id).toMatch(/^perf_/);
    expect(p.source).toBe('manual');
    expect(p.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.performances)).items).toHaveLength(1);
  });
  it('id가 있으면 수정, 없는 id는 NOT_FOUND', async () => {
    const mem = new MemoryStore();
    const id = (await savePerformance(mem, inp())).items[0]!.id;
    const snap = await savePerformance(mem, inp({ id, title: '수정됨' }));
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]!.title).toBe('수정됨');
    expect(await codeOf(savePerformance(mem, inp({ id: 'perf_none' })))).toBe('NOT_FOUND');
  });
  it('검증 실패는 INVALID_VALUE', async () => {
    expect(await codeOf(savePerformance(new MemoryStore(), inp({ amount: 0 })))).toBe('INVALID_VALUE');
  });
  it('삭제하고 없는 id는 NOT_FOUND', async () => {
    const mem = new MemoryStore();
    const id = (await savePerformance(mem, inp())).items[0]!.id;
    expect((await deletePerformance(mem, id)).items).toHaveLength(0);
    expect(await codeOf(deletePerformance(mem, id))).toBe('NOT_FOUND');
  });
  it('import append는 유지, replace는 removed 수를 센다', async () => {
    const mem = new MemoryStore();
    await savePerformance(mem, inp());
    const a = await importPerformances(mem, { mode: 'append', add: [inp({ title: 'B' }), inp({ title: 'C' })] });
    expect(a.summary).toEqual({ added: 2, removed: 0, skipped: [] });
    expect(a.items).toHaveLength(3);
    expect(a.items.filter((p) => p.source === 'excel')).toHaveLength(2);
    const r = await importPerformances(mem, { mode: 'replace', add: [inp({ title: 'D' })] });
    expect(r.summary).toMatchObject({ added: 1, removed: 3 });
    expect(r.items.map((p) => p.title)).toEqual(['D']);
  });
  it('skipped는 행 번호와 이유를 담는다', async () => {
    const r = await importPerformances(new MemoryStore(), { mode: 'append', add: [inp(), inp({ amount: 1.5 }), inp()] });
    expect(r.summary.added).toBe(2);
    expect(r.summary.skipped).toHaveLength(1);
    expect(r.summary.skipped[0]!.row).toBe(2);
    expect(r.summary.skipped[0]!.reason).toBeTruthy();
  });
  it('변경이 없으면 파일을 쓰지 않는다', async () => {
    const mem = new MemoryStore();
    await importPerformances(mem, { mode: 'append', add: [inp({ amount: 0 })] });
    await expect(mem.readText(CONFIG_PATHS.performances)).rejects.toBeTruthy();
  });
  it('손상 파일은 CONFIG_CORRUPT와 path', async () => {
    const mem = new MemoryStore();
    await mem.writeText(CONFIG_PATHS.performances, '{broken');
    const e = await listPerformances(mem).then(() => null, (x) => x);
    expect(e.code).toBe('CONFIG_CORRUPT');
    expect(e.path).toBe('config/performances.json');
  });
  it('정렬: 진행 중이 맨 위, 완료일 내림차순, 같으면 착수일 내림차순', async () => {
    const mem = new MemoryStore();
    await savePerformance(mem, inp({ title: 'old', endAt: '2022-01-01', startAt: '2021-01-01' }));
    await savePerformance(mem, inp({ title: 'ongoing', endAt: undefined }));
    await savePerformance(mem, inp({ title: 'newA', endAt: '2024-06-30', startAt: '2024-01-01' }));
    await savePerformance(mem, inp({ title: 'newB', endAt: '2024-06-30', startAt: '2024-03-01' }));
    expect((await listPerformances(mem)).items.map((p) => p.title)).toEqual(['ongoing', 'newB', 'newA', 'old']);
  });
});
