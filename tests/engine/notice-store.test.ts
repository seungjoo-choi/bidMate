import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { entryOf, NoticeStore } from '../../src/engine/notices/notice-store';
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
  it('entryOf는 bid에서 schedule을 넣고 없으면 키를 생략한다', () => {
    const n = mk('R1-000', '가', 'f');
    expect('schedule' in entryOf(n)).toBe(false);
    n.schedule.registrationDeadline = { value: '2026-10-20T10:00:00+09:00', status: 'verified' };
    n.schedule.openingAt = { value: '2026-10-25T10:00:00+09:00', status: 'verified' };
    expect(entryOf(n).schedule).toEqual({ registrationDeadline: '2026-10-20T10:00:00+09:00', openingAt: '2026-10-25T10:00:00+09:00' });
  });
  it('entryOf는 사전규격에 schedule을 넣지 않는다', () => {
    const n = emptyNotice('P1', { noticeNo: 'P1', origin: 'g2b', kind: 'prespec' }, 'f', '2026-10-17T00:00:00Z');
    n.schedule.openingAt = { value: '2026-10-25T10:00:00+09:00', status: 'verified' };
    expect('schedule' in entryOf(n)).toBe(false);
  });
  it('indexVersion 없는 index는 loadIndex가 재생성한다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    const n = mk('R1-000', '가', 'notices/2026/R1-000_가');
    n.schedule.openingAt = { value: '2026-10-25T10:00:00+09:00', status: 'verified' };
    await ns.saveNotice(n);
    const raw = JSON.parse(await mem.readText('index.json'));
    delete raw.indexVersion;
    delete raw.notices[0].schedule;
    await mem.writeText('index.json', JSON.stringify(raw));
    const idx = await ns.loadIndex();
    expect(idx.indexVersion).toBe(3);
    expect(idx.notices[0]?.schedule?.openingAt).toBe('2026-10-25T10:00:00+09:00');
    expect(JSON.parse(await mem.readText('index.json')).indexVersion).toBe(3);
  });
  it('옛 index 보충은 notice.json을 못 읽은 항목도 지우지 않는다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    await ns.saveNotice(mk('R1-000', '가', 'notices/2026/R1-000_가'));
    const raw = JSON.parse(await mem.readText('index.json'));
    delete raw.indexVersion;
    raw.notices.push({ ...raw.notices[0], noticeId: 'R2-000', folder: 'notices/2026/R2-000_없음' });
    await mem.writeText('index.json', JSON.stringify(raw));
    const idx = await ns.loadIndex();
    expect(idx.notices.map((e) => e.noticeId)).toEqual(['R1-000', 'R2-000']);
    expect(idx.indexVersion).toBe(3);
  });
  it('옛 버전 index에 saveNotice해도 버전을 올리지 않는다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    await ns.saveNotice(mk('R1-000', '가', 'notices/2026/R1-000_가'));
    const raw = JSON.parse(await mem.readText('index.json'));
    delete raw.indexVersion;
    await mem.writeText('index.json', JSON.stringify(raw));
    await ns.saveNotice(mk('R2-000', '나', 'notices/2026/R2-000_나'));
    expect(JSON.parse(await mem.readText('index.json')).indexVersion).toBeUndefined();
  });
  it('saveNotice 결과 index에 indexVersion 3', async () => {
    const mem = new MemoryStore();
    await new NoticeStore(mem).saveNotice(mk('R1-000', '가', 'notices/2026/R1-000_가'));
    expect(JSON.parse(await mem.readText('index.json')).indexVersion).toBe(3);
  });
  it('v2 index는 로드 시 notice.json의 demandOrg로 보충하고 버전 3이 된다', async () => {
    const mem = new MemoryStore();
    const ns = new NoticeStore(mem);
    const n = mk('R1-000', '가', 'notices/2026/R1-000_가');
    n.basic.demandOrg = { value: '서울시', status: 'verified' };
    n.schedule.openingAt = { value: '2026-10-25T10:00:00+09:00', status: 'verified' };
    await ns.saveNotice(n);
    const raw = JSON.parse(await mem.readText('index.json'));
    raw.indexVersion = 2;
    delete raw.notices[0].demandOrg;
    await mem.writeText('index.json', JSON.stringify(raw));
    const idx = await ns.loadIndex();
    expect(idx.indexVersion).toBe(3);
    expect(idx.notices[0]?.demandOrg).toBe('서울시');
    expect(idx.notices[0]?.schedule?.openingAt).toBe('2026-10-25T10:00:00+09:00');
  });
  it('새로 저장한 공고의 index 항목에 demandOrg가 포함된다', async () => {
    const mem = new MemoryStore();
    const n = mk('R1-000', '가', 'notices/2026/R1-000_가');
    n.basic.demandOrg = { value: '서울시', status: 'verified' };
    await new NoticeStore(mem).saveNotice(n);
    expect(JSON.parse(await mem.readText('index.json')).notices[0].demandOrg).toBe('서울시');
  });
  it('demandOrg가 빈 공고는 항목에 키가 없다', () => {
    expect('demandOrg' in entryOf(mk('R1-000', '가', 'f'))).toBe(false);
  });
});

describe('entryOf reannounceOf', () => {
  it('reannounceOf를 복사하고 없으면 키를 생략한다', () => {
    const n = mk('R1-000', '가', 'f');
    expect('reannounceOf' in entryOf(n)).toBe(false);
    n.reannounceOf = 'R0';
    expect(entryOf(n).reannounceOf).toBe('R0');
  });
});
