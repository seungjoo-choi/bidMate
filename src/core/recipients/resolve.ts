import type { Group, Recipient } from '../types/recipient';
import { normalizeEmail } from './email';

export type ResolvedMember = { id: string; name: string; email: string; role: 'to' | 'cc' };
export type SkippedMember = { id: string; email?: string; name?: string; reason: 'missing' | 'disabled' | 'duplicate' };
export interface ResolvedRecipients {
  to: string[];
  cc: string[];
  members: ResolvedMember[];
  skipped: SkippedMember[];
}

// memberIds 순서대로 해석: 없음/비활성 제외, 역할 결정, 이메일 중복 제거(TO 우선)
export function resolveRecipients(group: Group, recipients: Recipient[]): ResolvedRecipients {
  const byId = new Map(recipients.map((r) => [r.id, r]));
  const candidates: ResolvedMember[] = [];
  const skipped: SkippedMember[] = [];
  for (const id of group.memberIds) {
    const r = byId.get(id);
    if (!r) { skipped.push({ id, reason: 'missing' }); continue; }
    if (r.enabled === false) { skipped.push({ id, email: r.email, name: r.name, reason: 'disabled' }); continue; }
    const role = (group.roleOverrides && Object.hasOwn(group.roleOverrides, id) ? group.roleOverrides[id] : undefined) ?? r.defaultRole;
    candidates.push({ id, name: r.name, email: normalizeEmail(r.email), role });
  }
  // TO에 있는 이메일은 CC 후보에서 제외하기 위해 TO를 먼저 확정
  const toEmails = new Set<string>();
  for (const c of candidates) if (c.role === 'to') toEmails.add(c.email);
  const seen = new Set<string>();
  const members: ResolvedMember[] = [];
  for (const c of candidates) {
    if (seen.has(c.email) || (c.role === 'cc' && toEmails.has(c.email))) {
      skipped.push({ id: c.id, email: c.email, name: c.name, reason: 'duplicate' });
      continue;
    }
    seen.add(c.email);
    members.push(c);
  }
  return {
    to: members.filter((m) => m.role === 'to').map((m) => m.email),
    cc: members.filter((m) => m.role === 'cc').map((m) => m.email),
    members,
    skipped,
  };
}
