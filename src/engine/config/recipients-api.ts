import { newId } from '../../core/model/ids';
import { isValidEmail, normalizeEmail } from '../../core/recipients/email';
import { dedupeDefault, normalizeGroup, normalizeRecipient } from '../../core/recipients/normalize';
import type { GroupInput, RecipientInput, RecipientsSnapshot } from '../../core/types/config-file';
import { ALL_GROUP_ID, type Group, type Recipient } from '../../core/types/recipient';
import type { IFileStore } from '../file-store/types';
import { loadList, saveList, withConfigLock } from './config-store';

export interface ConfigOpts { now?: () => Date }

export { ALL_GROUP_ID } from '../../core/types/recipient';
export const ALL_GROUP_NAME = '전체';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const isRole = (v: unknown): v is 'to' | 'cc' => v === 'to' || v === 'cc';
const nowOf = (opts: ConfigOpts): Date => (opts.now ?? (() => new Date()))();

interface State { recipients: Recipient[]; groups: Group[]; warnings: string[] }

async function loadState(store: IFileStore, now: Date): Promise<State> {
  const nowIso = now.toISOString();
  let skipped = 0;
  const r = await loadList<Recipient>(store, 'recipients', (raw, fileAt) => {
    const item = normalizeRecipient(raw, fileAt);
    if (!item) skipped++;
    return { item, warnings: [] };
  }, now);
  const g = await loadList<Group>(store, 'groups', (raw, fileAt) => ({ item: normalizeGroup(raw, fileAt || nowIso), warnings: [] }), now);
  const warnings = [...r.warnings, ...g.warnings];
  if (skipped > 0) warnings.push(`이메일이 없는 수신자 ${skipped}명을 건너뛰었습니다`);
  return { recipients: r.items, groups: dedupeDefault(g.items), warnings };
}

/** 끊어진 memberIds 경고는 최종 상태 기준으로 만든다. */
function snapshotOf(s: State): RecipientsSnapshot {
  const ids = new Set(s.recipients.map((r) => r.id));
  const warnings = [...s.warnings];
  for (const g of s.groups) {
    const n = g.memberIds.filter((id) => !ids.has(id)).length;
    if (n > 0) warnings.push(`그룹 "${g.name}": 존재하지 않는 수신자 ${n}명이 있습니다(해석 시 무시, 저장 시 제거)`);
  }
  return { recipients: s.recipients, groups: s.groups, warnings };
}

/** 저장 시 끊어진 memberIds와 roleOverrides를 제거한다. */
function cleanGroups(groups: Group[], recipients: Recipient[]): Group[] {
  const ids = new Set(recipients.map((r) => r.id));
  return groups.map((g) => {
    const memberIds = g.memberIds.filter((id) => ids.has(id));
    const out: Group = { ...g, memberIds };
    if (g.roleOverrides) {
      const ov: Record<string, 'to' | 'cc'> = {};
      for (const [k, v] of Object.entries(g.roleOverrides)) if (ids.has(k)) ov[k] = v;
      out.roleOverrides = ov;
    }
    return out;
  });
}

export async function listRecipients(store: IFileStore, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return snapshotOf(await loadState(store, nowOf(opts)));
}

function optText(v: unknown, label: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw err('INVALID_VALUE', `${label}은(는) 문자열이어야 합니다.`);
  const t = v.trim();
  if (t.length > max) throw err('INVALID_VALUE', `${label}은(는) ${max}자 이하여야 합니다.`);
  return t === '' ? undefined : t;
}

export function saveRecipient(store: IFileStore, input: RecipientInput, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const nowIso = now.toISOString();
    if (typeof input?.email !== 'string') throw err('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
    if (!isValidEmail(input.email)) throw err('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
    const email = normalizeEmail(input.email);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 100) throw err('INVALID_VALUE', '이름은 1자 이상 100자 이하여야 합니다.');
    const dept = optText(input.dept, '부서', 200);
    const memo = optText(input.memo, '메모', 500);
    if (!isRole(input.defaultRole)) throw err('INVALID_VALUE', '기본 역할은 to 또는 cc여야 합니다.');
    if (typeof input.enabled !== 'boolean') throw err('INVALID_VALUE', '사용 여부는 true/false여야 합니다.');
    if (input.groupIds !== undefined && (!Array.isArray(input.groupIds) || input.groupIds.some((x) => typeof x !== 'string'))) {
      throw err('INVALID_VALUE', 'groupIds는 문자열 배열이어야 합니다.');
    }

    const s = await loadState(store, now);
    const idx = input.id ? s.recipients.findIndex((r) => r.id === input.id) : -1;
    if (input.id && idx < 0) throw err('NOT_FOUND', '수신자를 찾을 수 없습니다.');
    const id = idx >= 0 ? s.recipients[idx]!.id : newId('rcp');
    if (s.recipients.some((r) => r.id !== id && normalizeEmail(r.email) === email)) throw err('DUPLICATE_EMAIL', '이미 등록된 이메일입니다.');
    if (input.groupIds && input.groupIds.some((gid) => !s.groups.some((g) => g.id === gid))) throw err('NOT_FOUND', '그룹을 찾을 수 없습니다.');

    const rec: Recipient = { id, name, email, enabled: input.enabled, defaultRole: input.defaultRole, updatedAt: nowIso };
    if (dept !== undefined) rec.dept = dept;
    if (memo !== undefined) rec.memo = memo;
    if (idx >= 0) s.recipients[idx] = rec;
    else s.recipients.push(rec);

    let groupsChanged = false;
    if (input.groupIds) {
      const want = new Set(input.groupIds);
      s.groups = s.groups.map((g) => {
        const has = g.memberIds.includes(id);
        if (want.has(g.id) && !has) { groupsChanged = true; return { ...g, memberIds: [...g.memberIds, id], updatedAt: nowIso }; }
        if (!want.has(g.id) && has) { groupsChanged = true; return { ...g, memberIds: g.memberIds.filter((m) => m !== id), updatedAt: nowIso }; }
        return g;
      });
    }
    // 기본 그룹이 없으면 '전체'를 만들어 기본으로 지정한다. 새 수신자는 groupIds를 주지 않았을 때만 '전체'에 자동으로 넣는다
    // (화면은 소속 그룹을 항상 보내므로 사용자 선택을 따른다).
    const all = s.groups.find((g) => g.id === ALL_GROUP_ID);
    if (!s.groups.some((g) => g.isDefault)) {
      groupsChanged = true;
      if (all) s.groups = s.groups.map((g) => (g.id === ALL_GROUP_ID ? { ...g, isDefault: true, updatedAt: nowIso } : g));
      else s.groups.push({ id: ALL_GROUP_ID, name: ALL_GROUP_NAME, memberIds: s.recipients.map((r) => r.id), isDefault: true, updatedAt: nowIso });
    } else if (all && idx < 0 && input.groupIds === undefined && !all.memberIds.includes(id)) {
      groupsChanged = true;
      s.groups = s.groups.map((g) => (g.id === ALL_GROUP_ID ? { ...g, memberIds: [...g.memberIds, id], updatedAt: nowIso } : g));
    }
    await saveList(store, 'recipients', s.recipients, now);
    if (groupsChanged) {
      s.groups = cleanGroups(s.groups, s.recipients);
      await saveList(store, 'groups', s.groups, now);
    }
    return snapshotOf(s);
  });
}

export function deleteRecipient(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const s = await loadState(store, now);
    if (!s.recipients.some((r) => r.id === id)) throw err('NOT_FOUND', '수신자를 찾을 수 없습니다.');
    s.recipients = s.recipients.filter((r) => r.id !== id);
    await saveList(store, 'recipients', s.recipients, now);
    // 모든 그룹의 memberIds/roleOverrides에서 제거(끊어진 id도 함께 정리)
    s.groups = cleanGroups(s.groups, s.recipients);
    await saveList(store, 'groups', s.groups, now);
    return snapshotOf(s);
  });
}

export function saveGroup(store: IFileStore, input: GroupInput, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const nowIso = now.toISOString();
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 100) throw err('INVALID_VALUE', '그룹 이름은 1자 이상 100자 이하여야 합니다.');
    if (!Array.isArray(input.memberIds) || input.memberIds.some((x) => typeof x !== 'string')) throw err('INVALID_VALUE', 'memberIds는 문자열 배열이어야 합니다.');
    if (input.roleOverrides !== undefined && (typeof input.roleOverrides !== 'object' || input.roleOverrides === null || Array.isArray(input.roleOverrides)
      || Object.values(input.roleOverrides).some((v) => !isRole(v)))) {
      throw err('INVALID_VALUE', 'roleOverrides 값은 to 또는 cc여야 합니다.');
    }
    const s = await loadState(store, now);
    const idx = input.id ? s.groups.findIndex((g) => g.id === input.id) : -1;
    if (input.id && idx < 0) throw err('NOT_FOUND', '그룹을 찾을 수 없습니다.');
    const id = idx >= 0 ? s.groups[idx]!.id : newId('grp');
    const lower = name.toLowerCase();
    if (s.groups.some((g) => g.id !== id && g.name.trim().toLowerCase() === lower)) throw err('DUPLICATE_NAME', '같은 이름의 그룹이 이미 있습니다.');

    const g: Group = {
      id, name, memberIds: [...new Set(input.memberIds)], isDefault: idx >= 0 ? s.groups[idx]!.isDefault : false, updatedAt: nowIso,
    };
    if (input.roleOverrides) g.roleOverrides = { ...input.roleOverrides };
    if (idx >= 0) s.groups[idx] = g;
    else s.groups.push(g);
    s.groups = cleanGroups(s.groups, s.recipients);
    await saveList(store, 'groups', s.groups, now);
    return snapshotOf(s);
  });
}

export function deleteGroup(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const s = await loadState(store, now);
    if (!s.groups.some((g) => g.id === id)) throw err('NOT_FOUND', '그룹을 찾을 수 없습니다.');
    // 기본 그룹을 지워도 다른 그룹을 자동 승격하지 않는다.
    s.groups = cleanGroups(s.groups.filter((g) => g.id !== id), s.recipients);
    await saveList(store, 'groups', s.groups, now);
    return snapshotOf(s);
  });
}

export function setDefaultGroup(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<RecipientsSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const nowIso = now.toISOString();
    const s = await loadState(store, now);
    if (!s.groups.some((g) => g.id === id)) throw err('NOT_FOUND', '그룹을 찾을 수 없습니다.');
    s.groups = cleanGroups(s.groups.map((g) => {
      const want = g.id === id;
      return g.isDefault === want ? g : { ...g, isDefault: want, updatedAt: nowIso };
    }), s.recipients);
    await saveList(store, 'groups', s.groups, now);
    return snapshotOf(s);
  });
}
