import { describe, expect, it } from 'vitest';
import { CONFIG_PATHS, loadList, repairConfig, saveList, withConfigLock } from '../../src/engine/config/config-store';
import { MemoryStore } from '../helpers/memory-store';

const passthrough = (raw: unknown) => ({ item: typeof raw === 'string' ? raw : null, warnings: typeof raw === 'string' ? [] : ['문자열이 아닌 항목 제거'] });
const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => ({ code: e.code, path: e.path }));
const P = CONFIG_PATHS.recipients;

describe('config-store', () => {
  it('파일이 없으면 빈 목록을 돌려주고 파일을 만들지 않는다', async () => {
    const mem = new MemoryStore();
    const r = await loadList(mem, 'recipients', passthrough);
    expect(r).toEqual({ items: [], warnings: [], exists: false });
    expect(mem.files.size).toBe(0);
  });
  it('손상된 파일은 CONFIG_CORRUPT이고 파일이 바뀌지 않는다', async () => {
    for (const text of ['{broken', '[]', '"x"', JSON.stringify({ schemaVersion: 1, items: {} })]) {
      const mem = new MemoryStore();
      await mem.writeText(P, text);
      expect(await codeOf(loadList(mem, 'recipients', passthrough))).toEqual({ code: 'CONFIG_CORRUPT', path: P });
      expect(mem.files.get(P)).toBe(text);
    }
  });
  it('schemaVersion이 1보다 크면 CONFIG_NEWER', async () => {
    const mem = new MemoryStore();
    const text = JSON.stringify({ schemaVersion: 2, updatedAt: 'x', items: [] });
    await mem.writeText(P, text);
    expect(await codeOf(loadList(mem, 'recipients', passthrough))).toEqual({ code: 'CONFIG_NEWER', path: P });
    expect(mem.files.get(P)).toBe(text);
  });
  it('schemaVersion이 없으면 항목별 보정과 warnings를 모은다(파일은 쓰지 않음)', async () => {
    const mem = new MemoryStore();
    const text = JSON.stringify({ items: ['a', 3, 'b'] });
    await mem.writeText(P, text);
    const r = await loadList(mem, 'recipients', passthrough);
    expect(r.items).toEqual(['a', 'b']);
    expect(r.warnings).toEqual(['문자열이 아닌 항목 제거']);
    expect(r.exists).toBe(true);
    expect(mem.files.get(P)).toBe(text);
  });
  it('saveList는 ConfigList 형식으로 쓴다', async () => {
    const mem = new MemoryStore();
    await saveList(mem, 'groups', ['x'], new Date('2026-10-18T00:00:00Z'));
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.groups))).toEqual({ schemaVersion: 1, updatedAt: '2026-10-18T00:00:00.000Z', items: ['x'] });
  });
  it('repairConfig는 원문을 백업하고 빈 목록으로 초기화한다', async () => {
    const mem = new MemoryStore();
    await mem.writeText(P, '{broken');
    const { backupPath } = await repairConfig(mem, 'recipients', new Date('2026-10-18T01:02:03.000Z'));
    expect(backupPath).toBe('config/recipients.corrupt-2026-10-18T01-02-03.000Z.json');
    expect(mem.files.get(backupPath)).toBe('{broken');
    expect(JSON.parse(await mem.readText(P)).items).toEqual([]);
  });
  it('repairConfig는 원문을 읽을 수 없으면 백업 없이 초기화한다', async () => {
    const mem = new MemoryStore();
    const { backupPath } = await repairConfig(mem, 'templates');
    expect(backupPath).toBe('');
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.templates)).items).toEqual([]);
    expect([...mem.files.keys()]).toEqual([CONFIG_PATHS.templates]);
  });
  it('새 버전 파일은 items 모양이 달라도 CONFIG_NEWER이고, 숫자 아닌 버전은 CONFIG_CORRUPT(리뷰 지적)', async () => {
    const mem = new MemoryStore();
    await mem.writeText(P, JSON.stringify({ schemaVersion: 2, items: { a: 1 } }));
    expect(await codeOf(loadList(mem, 'recipients', passthrough))).toEqual({ code: 'CONFIG_NEWER', path: P });
    await mem.writeText(P, JSON.stringify({ schemaVersion: 'x', items: [] }));
    expect(await codeOf(loadList(mem, 'recipients', passthrough))).toEqual({ code: 'CONFIG_CORRUPT', path: P });
  });
  it('repairConfig는 백업 쓰기가 실패하면 원본을 지우지 않는다(리뷰 지적)', async () => {
    const mem = new MemoryStore();
    await mem.writeText(P, '{broken');
    const orig = mem.writeText.bind(mem);
    mem.writeText = async (path: string, text: string) => {
      if (path.includes('.corrupt-')) throw Object.assign(new Error('디스크 공간 부족'), { code: 'DISK_FULL' });
      return orig(path, text);
    };
    expect(await codeOf(repairConfig(mem, 'recipients'))).toEqual({ code: 'DISK_FULL', path: undefined });
    expect(mem.files.get(P)).toBe('{broken');
  });
  it('withConfigLock은 변경을 직렬화한다', async () => {
    const mem = new MemoryStore();
    const log: string[] = [];
    const task = (n: string, ms: number) => withConfigLock(mem, async () => {
      log.push(`${n}:start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${n}:end`);
    });
    await Promise.all([task('a', 20), task('b', 0)]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});
