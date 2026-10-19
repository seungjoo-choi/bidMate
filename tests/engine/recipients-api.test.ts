import { describe, expect, it } from 'vitest';
import { CONFIG_PATHS } from '../../src/engine/config/config-store';
import {
  ALL_GROUP_ID, deleteGroup, deleteRecipient, importRecipients, listRecipients, saveGroup, saveRecipient, setDefaultGroup,
} from '../../src/engine/config/recipients-api';
import type { RecipientInput } from '../../src/core/types/config-file';
import { MemoryStore } from '../helpers/memory-store';

const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => e.code as string);
const rcp = (o: Partial<RecipientInput> = {}): RecipientInput => ({ name: '김철수', email: 'Kim@Example.com ', enabled: true, defaultRole: 'to', ...o });
const grp = (name: string, memberIds: string[] = []) => ({ name, memberIds });

describe('recipients-api', () => {
  it('수신자를 생성하고 이메일을 정규화해 저장한다', async () => {
    const mem = new MemoryStore();
    const snap = await saveRecipient(mem, rcp({ dept: ' 영업 ', memo: '' }));
    expect(snap.recipients).toHaveLength(1);
    const r = snap.recipients[0]!;
    expect(r.email).toBe('kim@example.com');
    expect(r.dept).toBe('영업');
    expect(r.memo).toBeUndefined();
    expect(r.id).toMatch(/^rcp_/);
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.recipients)).items[0].email).toBe('kim@example.com');
  });
  it('정규화 후 같은 이메일이면 DUPLICATE_EMAIL, 형식 오류는 INVALID_EMAIL', async () => {
    const mem = new MemoryStore();
    await saveRecipient(mem, rcp());
    expect(await codeOf(saveRecipient(mem, rcp({ name: '다른사람', email: ' KIM@example.com' })))).toBe('DUPLICATE_EMAIL');
    expect(await codeOf(saveRecipient(mem, rcp({ email: 'a@b' })))).toBe('INVALID_EMAIL');
    expect(await codeOf(saveRecipient(mem, rcp({ name: ' ' })))).toBe('INVALID_VALUE');
  });
  it('같은 id로 저장하면 수정되고 자기 이메일은 중복이 아니다', async () => {
    const mem = new MemoryStore();
    const id = (await saveRecipient(mem, rcp())).recipients[0]!.id;
    const snap = await saveRecipient(mem, rcp({ id, name: '김영희' }));
    expect(snap.recipients).toHaveLength(1);
    expect(snap.recipients[0]!.name).toBe('김영희');
  });
  it('없는 id는 NOT_FOUND', async () => {
    const mem = new MemoryStore();
    expect(await codeOf(saveRecipient(mem, rcp({ id: 'nope' })))).toBe('NOT_FOUND');
    expect(await codeOf(deleteRecipient(mem, 'nope'))).toBe('NOT_FOUND');
    expect(await codeOf(saveGroup(mem, { ...grp('g'), id: 'nope' }))).toBe('NOT_FOUND');
    expect(await codeOf(deleteGroup(mem, 'nope'))).toBe('NOT_FOUND');
    expect(await codeOf(setDefaultGroup(mem, 'nope'))).toBe('NOT_FOUND');
  });
  it('groupIds로 소속을 맞춘다', async () => {
    const mem = new MemoryStore();
    const g1 = (await saveGroup(mem, grp('A'))).groups[0]!.id;
    const g2 = (await saveGroup(mem, grp('B'))).groups[1]!.id;
    let snap = await saveRecipient(mem, rcp({ groupIds: [g1, g2] }));
    const id = snap.recipients[0]!.id;
    // 기본 그룹이 없었으므로 저장 시 '전체'가 세 번째로 생기고 수신자가 들어 있다.
    expect(snap.groups.map((g) => g.memberIds)).toEqual([[id], [id], [id]]);
    snap = await saveRecipient(mem, rcp({ id, groupIds: [g2] }));
    expect(snap.groups.map((g) => g.memberIds)).toEqual([[], [id], []]);
    // groupIds에 없는 '전체'에서는 먼저 빠진다(groupIds 처리가 자동 보정보다 앞선다).
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items[0].memberIds).toEqual([]);
    expect(await codeOf(saveRecipient(mem, rcp({ id, groupIds: ['nope'] })))).toBe('NOT_FOUND');
  });
  it('수신자를 삭제하면 모든 그룹의 memberIds/roleOverrides에서 제거된다', async () => {
    const mem = new MemoryStore();
    const id = (await saveRecipient(mem, rcp())).recipients[0]!.id;
    const other = (await saveRecipient(mem, rcp({ email: 'b@c.com' }))).recipients[1]!.id;
    await saveGroup(mem, { ...grp('A', [id, other]), roleOverrides: { [id]: 'cc', [other]: 'cc' } });
    await saveGroup(mem, grp('B', [id]));
    const snap = await deleteRecipient(mem, id);
    const a = snap.groups.find((g) => g.name === 'A')!;
    const b = snap.groups.find((g) => g.name === 'B')!;
    expect(snap.recipients.map((r) => r.id)).toEqual([other]);
    expect(a.memberIds).toEqual([other]);
    expect(a.roleOverrides).toEqual({ [other]: 'cc' });
    expect(b.memberIds).toEqual([]);
    const disk = JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items;
    expect(disk.find((g: { name: string }) => g.name === 'A').memberIds).toEqual([other]);
  });
  it('그룹 이름은 대소문자/공백 무시로 중복을 막는다', async () => {
    const mem = new MemoryStore();
    await saveGroup(mem, grp('Team A'));
    expect(await codeOf(saveGroup(mem, grp(' team a ')))).toBe('DUPLICATE_NAME');
    expect(await codeOf(saveGroup(mem, grp('')))).toBe('INVALID_VALUE');
  });
  it('set-default는 그 그룹만 기본으로 만든다', async () => {
    const mem = new MemoryStore();
    await saveGroup(mem, grp('A'));
    const s = await saveGroup(mem, grp('B'));
    let snap = await setDefaultGroup(mem, s.groups[0]!.id);
    snap = await setDefaultGroup(mem, s.groups[1]!.id);
    expect(snap.groups.map((g) => g.isDefault)).toEqual([false, true]);
  });
  it('기본 그룹을 지워도 다른 그룹을 승격하지 않는다', async () => {
    const mem = new MemoryStore();
    const s = await saveGroup(mem, grp('A'));
    await saveGroup(mem, grp('B'));
    await setDefaultGroup(mem, s.groups[0]!.id);
    const snap = await deleteGroup(mem, s.groups[0]!.id);
    expect(snap.groups.map((g) => g.isDefault)).toEqual([false]);
  });
  it('끊어진 memberIds는 읽기에서 warning, 저장 시 제거된다', async () => {
    const mem = new MemoryStore();
    const id = (await saveRecipient(mem, rcp())).recipients[0]!.id;
    const gid = (await saveGroup(mem, grp('A', [id]))).groups.find((g) => g.name === 'A')!.id;
    const items = JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items;
    const ai = items.findIndex((g: { id: string }) => g.id === gid);
    items[ai].memberIds = [id, 'ghost'];
    await mem.writeText(CONFIG_PATHS.groups, JSON.stringify({ schemaVersion: 1, updatedAt: 'x', items }));
    const listed = await listRecipients(mem);
    expect(listed.warnings.some((w) => w.includes('1명'))).toBe(true);
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items[ai].memberIds).toContain('ghost');
    const snap = await saveGroup(mem, { ...grp('A', [id, 'ghost']), id: gid });
    expect(snap.groups.find((g) => g.id === gid)!.memberIds).toEqual([id]);
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items[ai].memberIds).toEqual([id]);
  });
  it('이메일이 없는 수신자는 건너뛰고 warning을 남긴다', async () => {
    const mem = new MemoryStore();
    await mem.writeText(CONFIG_PATHS.recipients, JSON.stringify({ schemaVersion: 1, updatedAt: 'x', items: [{ id: 'r1', name: 'x' }, { id: 'r2', name: 'y', email: 'y@z.com' }] }));
    const snap = await listRecipients(mem);
    expect(snap.recipients.map((r) => r.id)).toEqual(['r2']);
    expect(snap.warnings).toContain('이메일이 없는 수신자 1명을 건너뛰었습니다');
  });
  describe('기본 그룹 자동 보정', () => {
    it('그룹이 없을 때 첫 수신자를 추가하면 전체 기본 그룹이 생기고 그 수신자가 들어 있다', async () => {
      const mem = new MemoryStore();
      const snap = await saveRecipient(mem, rcp());
      const id = snap.recipients[0]!.id;
      expect(snap.groups).toHaveLength(1);
      expect(snap.groups[0]).toMatchObject({ id: ALL_GROUP_ID, name: '전체', isDefault: true, memberIds: [id] });
      expect(JSON.parse(await mem.readText(CONFIG_PATHS.groups)).items[0]).toMatchObject({ id: ALL_GROUP_ID, isDefault: true, memberIds: [id] });
    });
    it('기본 그룹이 없는 상태에서 기존 수신자를 수정해 저장해도 전체가 생기고 기존 수신자 전원이 들어 있다', async () => {
      const mem = new MemoryStore();
      await mem.writeText(CONFIG_PATHS.recipients, JSON.stringify({ schemaVersion: 1, updatedAt: 'x', items: [
        { id: 'r1', name: '가', email: 'a@x.com', enabled: true, defaultRole: 'to', updatedAt: 'x' },
        { id: 'r2', name: '나', email: 'b@x.com', enabled: true, defaultRole: 'to', updatedAt: 'x' },
      ] }));
      const snap = await saveRecipient(mem, rcp({ id: 'r1', name: '가가', email: 'a@x.com' }));
      expect(snap.groups).toHaveLength(1);
      expect(snap.groups[0]).toMatchObject({ id: ALL_GROUP_ID, name: '전체', isDefault: true });
      expect(snap.groups[0]!.memberIds).toEqual(['r1', 'r2']);
    });
    it('전체가 있는 상태에서 두 번째 수신자를 추가하면 전체에 추가된다', async () => {
      const mem = new MemoryStore();
      const id1 = (await saveRecipient(mem, rcp())).recipients[0]!.id;
      const snap = await saveRecipient(mem, rcp({ name: '이영희', email: 'b@c.com' }));
      const id2 = snap.recipients[1]!.id;
      expect(snap.groups).toHaveLength(1);
      expect(snap.groups[0]!.memberIds).toEqual([id1, id2]);
    });
    it('전체가 있어도 groupIds를 주면 그 선택을 따르고 전체에 자동으로 넣지 않는다', async () => {
      const mem = new MemoryStore();
      const id1 = (await saveRecipient(mem, rcp())).recipients[0]!.id;
      const snap = await saveRecipient(mem, rcp({ name: '이영희', email: 'b@c.com', groupIds: [] }));
      expect(snap.groups).toHaveLength(1);
      expect(snap.groups[0]!.memberIds).toEqual([id1]);
    });
    it('사용자가 만든 다른 기본 그룹이 있고 전체가 없으면 그룹이 새로 생기지 않는다', async () => {
      const mem = new MemoryStore();
      const gid = (await saveGroup(mem, grp('A'))).groups[0]!.id;
      await setDefaultGroup(mem, gid);
      const snap = await saveRecipient(mem, rcp());
      expect(snap.groups).toHaveLength(1);
      expect(snap.groups[0]).toMatchObject({ id: gid, isDefault: true, memberIds: [] });
    });
    it('사용자가 만든 기본 그룹이 있고 전체가 기본이 아니면 신규 수신자는 전체에만 추가되고 기본 그룹은 바뀌지 않는다', async () => {
      const mem = new MemoryStore();
      await mem.writeText(CONFIG_PATHS.groups, JSON.stringify({ schemaVersion: 1, updatedAt: 'x', items: [
        { id: ALL_GROUP_ID, name: '전체', memberIds: [], isDefault: false, updatedAt: 'x' },
        { id: 'g-user', name: 'A', memberIds: [], isDefault: true, updatedAt: 'x' },
      ] }));
      const snap = await saveRecipient(mem, rcp());
      const id = snap.recipients[0]!.id;
      const all = snap.groups.find((g) => g.id === ALL_GROUP_ID)!;
      const user = snap.groups.find((g) => g.id === 'g-user')!;
      expect(all.memberIds).toEqual([id]);
      expect(all.isDefault).toBeFalsy();
      expect(user.memberIds).toEqual([]);
      expect(user.isDefault).toBe(true);
    });
  });

  describe('importRecipients', () => {
    const seed = async (mem: MemoryStore) => {
      await saveRecipient(mem, rcp({ name: '가', email: 'a@x.com', dept: '영업', memo: '메모', defaultRole: 'cc' }));
      await saveRecipient(mem, rcp({ name: '나', email: 'b@x.com' }));
      await saveRecipient(mem, rcp({ name: '다', email: 'c@x.com' }));
      const snap = await listRecipients(mem);
      const gid = (await saveGroup(mem, grp('A', snap.recipients.map((r) => r.id)))).groups.find((g) => g.name === 'A')!.id;
      return { ids: snap.recipients.map((r) => r.id), gid };
    };
    const countWrites = (mem: MemoryStore) => {
      const writes: string[] = [];
      const orig = mem.writeText.bind(mem);
      mem.writeText = async (p: string, t: string) => { writes.push(p); return orig(p, t); };
      return writes;
    };

    it('add2+update1+disable1은 recipients 파일을 1회만 쓰고 그룹 파일은 쓰지 않는다', async () => {
      const mem = new MemoryStore();
      const { ids } = await seed(mem);
      const groupsBefore = await mem.readText(CONFIG_PATHS.groups);
      const writes = countWrites(mem);
      const res = await importRecipients(mem, {
        add: [{ name: '신1', email: 'N1@x.com', dept: '개발' }, { name: '신2', email: 'n2@x.com' }],
        update: [{ id: ids[0]!, name: '가가', dept: '기획' }],
        disable: [ids[1]!],
      });
      expect(res.summary).toMatchObject({ added: 2, updated: 1, disabled: 1, skipped: [] });
      expect(writes.filter((p) => p === CONFIG_PATHS.recipients)).toHaveLength(1);
      expect(writes.filter((p) => p === CONFIG_PATHS.groups)).toHaveLength(0);
      expect(await mem.readText(CONFIG_PATHS.groups)).toBe(groupsBefore);
      expect(res.recipients).toHaveLength(5);
      const added = res.recipients.find((r) => r.email === 'n1@x.com')!;
      expect(added).toMatchObject({ name: '신1', dept: '개발', enabled: true, defaultRole: 'to' });
      expect(added.id).toMatch(/^rcp_/);
    });
    it('새 사람은 그룹에 들어가지 않고 전체 그룹도 만들어지지 않는다', async () => {
      const mem = new MemoryStore();
      const res = await importRecipients(mem, { add: [{ name: '신', email: 'n@x.com' }], update: [], disable: [] });
      expect(res.recipients).toHaveLength(1);
      expect(res.groups).toEqual([]);
      expect(mem.files.has(CONFIG_PATHS.groups)).toBe(false);
    });
    it('update는 name/dept/updatedAt만 바꾸고 memo·defaultRole·enabled·그룹 소속은 유지한다', async () => {
      const mem = new MemoryStore();
      const { ids, gid } = await seed(mem);
      const res = await importRecipients(mem, { add: [], update: [{ id: ids[0]!, name: '새이름', dept: '기획' }], disable: [] });
      const r = res.recipients.find((x) => x.id === ids[0])!;
      expect(r).toMatchObject({ name: '새이름', dept: '기획', memo: '메모', defaultRole: 'cc', enabled: true, email: 'a@x.com' });
      expect(res.groups.find((g) => g.id === gid)!.memberIds).toContain(ids[0]);
    });
    it('update에서 dept를 생략하면 부서가 제거된다', async () => {
      const mem = new MemoryStore();
      const { ids } = await seed(mem);
      const res = await importRecipients(mem, { add: [], update: [{ id: ids[0]!, name: '가' }], disable: [] });
      expect(res.recipients.find((x) => x.id === ids[0])!.dept).toBeUndefined();
      expect(JSON.parse(await mem.readText(CONFIG_PATHS.recipients)).items[0]).not.toHaveProperty('dept');
    });
    it('기존 이메일 형식이 이상해도 update는 반영된다', async () => {
      const mem = new MemoryStore();
      await mem.writeText(CONFIG_PATHS.recipients, JSON.stringify({ schemaVersion: 1, updatedAt: 'x', items: [
        { id: 'r1', name: '가', email: 'bad@email', enabled: true, defaultRole: 'to', updatedAt: 'x' },
      ] }));
      const res = await importRecipients(mem, { add: [], update: [{ id: 'r1', name: '새이름', dept: '기획' }], disable: [] });
      expect(res.summary).toMatchObject({ updated: 1, skipped: [] });
      expect(res.recipients[0]).toMatchObject({ name: '새이름', dept: '기획', email: 'bad@email' });
    });
    it('add의 중복 이메일(기존/이번 추가분)은 skipped, 나머지는 정상 처리된다', async () => {
      const mem = new MemoryStore();
      await seed(mem);
      const res = await importRecipients(mem, {
        add: [{ name: '중복', email: 'A@x.com' }, { name: '신', email: 'n@x.com' }, { name: '신중복', email: 'N@x.com' }],
        update: [], disable: [],
      });
      expect(res.summary.added).toBe(1);
      expect(res.summary.skipped.map((s) => s.key)).toEqual(['A@x.com', 'N@x.com']);
      expect(res.recipients).toHaveLength(4);
    });
    it('update의 id가 없으면 skipped', async () => {
      const mem = new MemoryStore();
      await seed(mem);
      const res = await importRecipients(mem, { add: [], update: [{ id: 'nope', name: 'x' }], disable: [] });
      expect(res.summary.updated).toBe(0);
      expect(res.summary.skipped).toEqual([{ key: 'nope', reason: expect.any(String) }]);
    });
    it('이미 발송 끈 사람을 disable하면 카운트 없이 통과하고 기록하지 않는다', async () => {
      const mem = new MemoryStore();
      const { ids } = await seed(mem);
      await importRecipients(mem, { add: [], update: [], disable: [ids[1]!] });
      const writes = countWrites(mem);
      const res = await importRecipients(mem, { add: [], update: [], disable: [ids[1]!] });
      expect(res.summary).toEqual({ added: 0, updated: 0, disabled: 0, skipped: [] });
      expect(writes).toHaveLength(0);
    });
    it('빈 plan은 파일을 기록하지 않는다', async () => {
      const mem = new MemoryStore();
      await seed(mem);
      const writes = countWrites(mem);
      const res = await importRecipients(mem, { add: [], update: [], disable: [] });
      expect(writes).toHaveLength(0);
      expect(res.recipients).toHaveLength(3);
    });
    it('plan 형식 오류는 INVALID_VALUE', async () => {
      const mem = new MemoryStore();
      expect(await codeOf(importRecipients(mem, { add: [], update: [] } as never))).toBe('INVALID_VALUE');
      expect(await codeOf(importRecipients(mem, { add: 'x', update: [], disable: [] } as never))).toBe('INVALID_VALUE');
    });
  });
});
