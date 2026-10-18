import { describe, expect, it } from 'vitest';
import { resolveRecipients } from '../../src/core/recipients/resolve';
import type { Group, Recipient } from '../../src/core/types/recipient';

const rcp = (id: string, email: string, over: Partial<Recipient> = {}): Recipient => ({
  id, name: id.toUpperCase(), email, enabled: true, defaultRole: 'to', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const grp = (memberIds: string[], over: Partial<Group> = {}): Group => ({
  id: 'g', name: 'G', memberIds, isDefault: false, updatedAt: '2026-01-01T00:00:00Z', ...over,
});

describe('resolveRecipients', () => {
  it('disabled 제외', () => {
    const r = resolveRecipients(grp(['a', 'b']), [rcp('a', 'a@x.com'), rcp('b', 'b@x.com', { enabled: false })]);
    expect(r.to).toEqual(['a@x.com']);
    expect(r.skipped).toEqual([{ id: 'b', email: 'b@x.com', name: 'B', reason: 'disabled' }]);
  });
  it('missing 제외', () => {
    const r = resolveRecipients(grp(['a', 'zz']), [rcp('a', 'a@x.com')]);
    expect(r.skipped).toEqual([{ id: 'zz', reason: 'missing' }]);
  });
  it('roleOverrides가 defaultRole보다 우선', () => {
    const r = resolveRecipients(
      grp(['a', 'b'], { roleOverrides: { a: 'cc', b: 'to' } }),
      [rcp('a', 'a@x.com'), rcp('b', 'b@x.com', { defaultRole: 'cc' })],
    );
    expect(r.to).toEqual(['b@x.com']);
    expect(r.cc).toEqual(['a@x.com']);
  });
  it('TO와 CC에 모두 있으면 TO만(대소문자/공백 차이, CC가 먼저여도)', () => {
    const r = resolveRecipients(
      grp(['a', 'b']),
      [rcp('a', ' Dup@X.com ', { defaultRole: 'cc' }), rcp('b', 'dup@x.com', { defaultRole: 'to' })],
    );
    expect(r.to).toEqual(['dup@x.com']);
    expect(r.cc).toEqual([]);
    expect(r.skipped).toEqual([{ id: 'a', email: 'dup@x.com', name: 'A', reason: 'duplicate' }]);
  });
  it('같은 역할 중복은 첫 것 유지', () => {
    const r = resolveRecipients(grp(['a', 'b']), [rcp('a', 'd@x.com'), rcp('b', 'D@x.com')]);
    expect(r.members.map((m) => m.id)).toEqual(['a']);
    expect(r.skipped.map((s) => [s.id, s.reason])).toEqual([['b', 'duplicate']]);
  });
  it('memberIds 순서 보존', () => {
    const r = resolveRecipients(grp(['c', 'a', 'b']), [rcp('a', 'a@x.com'), rcp('b', 'b@x.com'), rcp('c', 'c@x.com')]);
    expect(r.to).toEqual(['c@x.com', 'a@x.com', 'b@x.com']);
  });
  it('빈 그룹', () => {
    expect(resolveRecipients(grp([]), [rcp('a', 'a@x.com')])).toEqual({ to: [], cc: [], members: [], skipped: [] });
  });
});
