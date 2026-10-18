import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const mk = (id: string, title: string, folder: string) => {
  const n = emptyNotice(id, { noticeNo: id, origin: 'g2b' }, folder, '2026-10-17T00:00:00Z');
  n.basic.title = { value: title, status: 'verified' };
  return n;
};

describe('NoticeStore', () => {
  it('기존 index 항목의 folder를 재사용한다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    const n = mk('R1-000', '원래 제목', 'notices/2026/R1-000_원래 제목');
    await ns.saveNotice(n);
    const folder = await ns.resolveFolder('R1-000', '바뀐 제목', '2026-01-01T00:00:00+09:00', '2026-10-17T00:00:00Z');
    expect(folder).toBe('notices/2026/R1-000_원래 제목');
    const fresh = await ns.resolveFolder('R2-000', '새 공고', null, '2026-10-17T00:00:00Z');
    expect(fresh).toBe('notices/2026/R2-000_새 공고');
  });
  it('index 손상 시 notice.json 스캔으로 재생성', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    await ns.saveNotice(mk('R1-000', '가', 'notices/2026/R1-000_가'));
    await ns.saveNotice(mk('R2-000', '나', 'notices/2026/R2-000_나'));
    await mem.writeText('index.json', '{broken');
    const idx = await ns.loadIndex();
    expect(idx.notices.map((e) => e.noticeId).sort()).toEqual(['R1-000', 'R2-000']);
    expect(JSON.parse(await mem.readText('index.json')).notices).toHaveLength(2);
  });
  it('notice.json과 index를 함께 쓰고 source 원문을 저장한다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    await ns.saveNotice(mk('R1-000', '가', 'notices/2026/R1-000_가'), { operation: 'Servc', item: { a: 1 } });
    expect(mem.files.has('notices/2026/R1-000_가/notice.json')).toBe(true);
    expect(mem.files.has('notices/2026/R1-000_가/source/api-Servc.json')).toBe(true);
    expect((await ns.loadNotice('R1-000'))?.id).toBe('R1-000');
  });
});
