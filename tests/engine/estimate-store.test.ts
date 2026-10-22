import { describe, expect, it } from 'vitest';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import { estimatePath, getEstimate, saveEstimate } from '../../src/engine/estimate/estimate-store';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/R1-000_가';
const idle = { isBusy: () => false };

async function setup() {
  const mem = new MemoryStore();
  const n = sampleNotice();
  n.id = 'R1-000'; n.folder = FOLDER;
  await new NoticeStore(mem).saveNotice(n);
  return mem;
}
const save = (mem: MemoryStore, key: 'management' | 'credibility' | 'performance', score: number | null, extra: { note?: string; max?: number | null } = {}, opts = idle) =>
  saveEstimate(mem, { noticeId: 'R1-000', key, score, max: extra.max ?? null, ...(extra.note ? { note: extra.note } : {}) }, opts);

describe('estimate-store', () => {
  it('파일이 없으면 get은 null, 공고가 없어도 null', async () => {
    const mem = await setup();
    expect(await getEstimate(mem, 'R1-000')).toBeNull();
    expect(await getEstimate(mem, 'NOPE')).toBeNull();
  });

  it('추가, 수정, null로 삭제', async () => {
    const mem = await setup();
    const a = await save(mem, 'management', 12.345, { note: '메모' });
    expect(a.items.management).toMatchObject({ score: 12.35, note: '메모' });
    await save(mem, 'performance', 5);
    const b = await save(mem, 'management', 10);
    expect(b.items.management?.score).toBe(10);
    expect(b.items.management?.note).toBe('메모');
    expect(Object.keys(b.items).sort()).toEqual(['management', 'performance']);
    expect((await getEstimate(mem, 'R1-000'))?.items.performance?.score).toBe(5);
    const c = await save(mem, 'management', null);
    expect(c.items.management).toBeUndefined();
    expect(c.items.performance?.score).toBe(5);
    expect(mem.files.has(estimatePath(FOLDER))).toBe(true);
  });

  it('note 생략 시 기존 메모 유지, 빈 문자열이면 삭제', async () => {
    const mem = await setup();
    await save(mem, 'management', 10, { note: '메모' });
    const a = await save(mem, 'management', 11);
    expect(a.items.management).toMatchObject({ score: 11, note: '메모' });
    const b = await saveEstimate(mem, { noticeId: 'R1-000', key: 'management', score: 12, note: '', max: null }, idle);
    expect(b.items.management?.note).toBeUndefined();
  });

  it('max 초과는 INVALID_VALUE', async () => {
    const mem = await setup();
    await expect(save(mem, 'management', 20, { max: 10 })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });

  it('공고가 없으면 NOT_FOUND', async () => {
    const mem = new MemoryStore();
    await expect(save(mem, 'management', 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('busy면 JOB_ALREADY_RUNNING으로 거부하고 쓰지 않는다', async () => {
    const mem = await setup();
    await expect(save(mem, 'management', 1, {}, { isBusy: () => true })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    expect(mem.files.has(estimatePath(FOLDER))).toBe(false);
  });

  it('손상된 파일은 빈 파일로 읽고 쓰지 않는다', async () => {
    const mem = await setup();
    mem.files.set(estimatePath(FOLDER), '{깨진 json');
    const f = await getEstimate(mem, 'R1-000');
    expect(f).toMatchObject({ schemaVersion: 1, noticeId: 'R1-000', items: {} });
    expect(mem.files.get(estimatePath(FOLDER))).toBe('{깨진 json');
  });
});
