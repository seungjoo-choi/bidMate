import type { RecipientImportPlan } from '../types/config-file';
import type { Recipient } from '../types/recipient';
import { isValidEmail, normalizeEmail } from './email';

export const FLAGGED_ORG_UNITS = ['휴직', '협력사', '계약직'] as const;
export const NW_CONTACT_HOST = 'contact.worksmobile.com';
export const NW_CONTACT_ORIGIN = 'https://contact.worksmobile.com/*';

const NAME_MAX = 100;
const DEPT_MAX = 200;

/** '/p/web/domain/133918'(URL 포함) 또는 '133918' → '133918', 아니면 null */
export function domainIdFrom(text: string): string | null {
  const t = (text ?? '').trim();
  if (/^\d+$/.test(t)) return t;
  const m = /\/p\/web\/domain\/(\d+)/.exec(t);
  return m?.[1] ?? null;
}

export interface NwContact { email: string /* 정규화 */; rawEmail: string; name: string; dept?: string; flagged: boolean; flagReason?: string; positionName?: string }
export interface NwParseResult { contacts: NwContact[]; skippedNoEmail: number; duplicateEmails: number }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// 네이버웍스 응답(검증 전)을 연락처 목록으로 변환
export function parseNwUsers(raw: unknown): NwParseResult {
  const out: NwParseResult = { contacts: [], skippedNoEmail: 0, duplicateEmails: 0 };
  if (!Array.isArray(raw)) return out;
  const seen = new Set<string>();
  for (const u of raw) {
    const o = (u ?? {}) as Record<string, unknown>;
    if (typeof o.email !== 'string' || !isValidEmail(o.email)) { out.skippedNoEmail++; continue; }
    const email = normalizeEmail(o.email);
    if (seen.has(email)) { out.duplicateEmails++; continue; }
    seen.add(email);
    const name = (str(o.name) || email.split('@')[0]!).slice(0, NAME_MAX).trimEnd();
    const units = Array.isArray(o.orgUnits) ? o.orgUnits.map(str).filter(Boolean) : [];
    const unitName = str(o.orgUnitName);
    const dept = (units.length ? units.join(' / ') : unitName).slice(0, DEPT_MAX).trimEnd() || undefined;
    const flagReason = [...units, unitName].find((x) => (FLAGGED_ORG_UNITS as readonly string[]).includes(x));
    const contact: NwContact = { email, rawEmail: o.email, name, flagged: flagReason !== undefined };
    if (dept) contact.dept = dept;
    if (flagReason !== undefined) contact.flagReason = flagReason;
    const pos = str(o.positionName);
    if (pos) contact.positionName = pos;
    out.contacts.push(contact);
  }
  return out;
}

export interface ContactDiff {
  added: NwContact[];
  changed: Array<{ recipient: Recipient; contact: NwContact; fields: Array<'name' | 'dept'> }>;
  missing: Recipient[];              // enabled===true 이고 목록에 없음
  unchanged: number;
  missingAlreadyDisabled: number;
}

const byDeptName = (a: { dept?: string; name: string }, b: { dept?: string; name: string }): number => {
  const ad = a.dept ?? '', bd = b.dept ?? '';
  if (!ad !== !bd) return ad ? -1 : 1;   // 빈 부서는 뒤
  return ad.localeCompare(bd, 'ko') || a.name.localeCompare(b.name, 'ko');
};

// 기존 수신자와 연락처를 이메일 기준으로 비교
export function diffContacts(contacts: NwContact[], recipients: Recipient[]): ContactDiff {
  const existing = new Map<string, Recipient>();
  for (const r of recipients) {
    const k = normalizeEmail(r.email);
    if (!existing.has(k)) existing.set(k, r);
  }
  const diff: ContactDiff = { added: [], changed: [], missing: [], unchanged: 0, missingAlreadyDisabled: 0 };
  const listed = new Set<string>();
  for (const c of contacts) {
    listed.add(c.email);
    const r = existing.get(c.email);
    if (!r) { diff.added.push(c); continue; }
    const fields: Array<'name' | 'dept'> = [];
    if (r.name.trim() !== c.name) fields.push('name');
    if ((r.dept ?? '') !== (c.dept ?? '')) fields.push('dept');
    if (fields.length) diff.changed.push({ recipient: r, contact: c, fields });
    else diff.unchanged++;
  }
  for (const [k, r] of existing) {
    if (listed.has(k)) continue;
    if (r.enabled) diff.missing.push(r);
    else diff.missingAlreadyDisabled++;
  }
  diff.added.sort(byDeptName);
  diff.changed.sort((a, b) => byDeptName(a.contact, b.contact));
  diff.missing.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return diff;
}

export interface DiffSelection { added: Set<string> /* email */; changed: Set<string> /* recipient id */; missing: Set<string> /* recipient id */ }

// flagged 제외 added/changed 전체, missing 비움
export function defaultSelection(diff: ContactDiff): DiffSelection {
  return {
    added: new Set(diff.added.filter((c) => !c.flagged).map((c) => c.email)),
    changed: new Set(diff.changed.filter((x) => !x.contact.flagged).map((x) => x.recipient.id)),
    missing: new Set(),
  };
}

// 선택된 항목만 반영 계획으로 변환
export function buildImportPlan(diff: ContactDiff, sel: DiffSelection): RecipientImportPlan {
  return {
    add: diff.added.filter((c) => sel.added.has(c.email)).map((c) => ({ name: c.name, email: c.email, ...(c.dept ? { dept: c.dept } : {}) })),
    update: diff.changed.filter((x) => sel.changed.has(x.recipient.id)).map((x) => ({ id: x.recipient.id, name: x.contact.name, ...(x.contact.dept ? { dept: x.contact.dept } : {}) })),
    disable: diff.missing.filter((r) => sel.missing.has(r.id)).map((r) => r.id),
  };
}

export const planCount = (p: RecipientImportPlan): number => p.add.length + p.update.length + p.disable.length;
