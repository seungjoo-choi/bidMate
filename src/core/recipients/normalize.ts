import type { Group, Recipient } from '../types/recipient';
import { newId } from '../model/ids';
import { normalizeEmail } from './email';

const isRole = (v: unknown): v is 'to' | 'cc' => v === 'to' || v === 'cc';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// 이메일이 없거나 비문자열이면 null(호출 측에서 제외와 warning 처리)
export function normalizeRecipient(raw: unknown, fallbackNow: string): Recipient | null {
  if (!isObj(raw)) return null;
  if (typeof raw.email !== 'string') return null;
  const email = normalizeEmail(raw.email);
  if (!email) return null;
  const r: Recipient = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('rcp'),
    name: typeof raw.name === 'string' ? raw.name : '',
    email,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    defaultRole: isRole(raw.defaultRole) ? raw.defaultRole : 'to',
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : fallbackNow,
  };
  if (typeof raw.dept === 'string') r.dept = raw.dept;
  if (typeof raw.memo === 'string') r.memo = raw.memo;
  return r;
}

export function normalizeGroup(raw: unknown, fallbackNow: string): Group {
  const o = isObj(raw) ? raw : {};
  const g: Group = {
    id: typeof o.id === 'string' && o.id ? o.id : newId('grp'),
    name: typeof o.name === 'string' && o.name ? o.name : '(이름 없음)',
    memberIds: Array.isArray(o.memberIds) ? o.memberIds.filter((x): x is string => typeof x === 'string') : [],
    isDefault: typeof o.isDefault === 'boolean' ? o.isDefault : false,
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : fallbackNow,
  };
  if (isObj(o.roleOverrides)) {
    const ov: Record<string, 'to' | 'cc'> = {};
    for (const [k, v] of Object.entries(o.roleOverrides)) if (isRole(v)) ov[k] = v;
    g.roleOverrides = ov;
  }
  return g;
}

// isDefault가 여러 개면 첫 번째만 남김
export function dedupeDefault(groups: Group[]): Group[] {
  let found = false;
  return groups.map((g) => {
    if (!g.isDefault) return g;
    if (!found) { found = true; return g; }
    return { ...g, isDefault: false };
  });
}
