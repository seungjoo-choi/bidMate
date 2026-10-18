import { describe, expect, it } from 'vitest';
import { dedupeDefault, normalizeGroup, normalizeRecipient } from '../../src/core/recipients/normalize';
import type { Group } from '../../src/core/types/recipient';

const NOW = '2026-10-18T00:00:00.000Z';

describe('normalizeRecipient', () => {
  it('id 부여와 이메일 정규화', () => {
    const r = normalizeRecipient({ name: 'A', email: ' A@X.com ' }, NOW)!;
    expect(r.id).toMatch(/^rcp_/);
    expect(r.email).toBe('a@x.com');
  });
  it('email 없음/빈 값이면 null', () => {
    expect(normalizeRecipient({ name: 'A' }, NOW)).toBeNull();
    expect(normalizeRecipient({ name: 'A', email: '  ' }, NOW)).toBeNull();
    expect(normalizeRecipient(null, NOW)).toBeNull();
  });
  it('기본값 보정', () => {
    const r = normalizeRecipient({ email: 'a@x.com', name: 5, enabled: 'yes', defaultRole: 'bcc', dept: 1, memo: {} }, NOW)!;
    expect(r.name).toBe('');
    expect(r.enabled).toBe(true);
    expect(r.defaultRole).toBe('to');
    expect(r.updatedAt).toBe(NOW);
    expect('dept' in r).toBe(false);
    expect('memo' in r).toBe(false);
  });
  it('유효한 값은 유지', () => {
    const r = normalizeRecipient(
      { id: 'rcp_1', email: 'a@x.com', name: 'A', enabled: false, defaultRole: 'cc', dept: 'D', memo: 'M', updatedAt: '2026-01-01T00:00:00Z' }, NOW)!;
    expect(r).toMatchObject({ id: 'rcp_1', enabled: false, defaultRole: 'cc', dept: 'D', memo: 'M', updatedAt: '2026-01-01T00:00:00Z' });
  });
});

describe('normalizeGroup', () => {
  it('id/이름 기본값', () => {
    const g = normalizeGroup({}, NOW);
    expect(g.id).toMatch(/^grp_/);
    expect(g.name).toBe('(이름 없음)');
    expect(g.isDefault).toBe(false);
    expect(g.memberIds).toEqual([]);
  });
  it('memberIds 비배열이면 빈 배열, 문자열 아닌 원소 제거', () => {
    expect(normalizeGroup({ memberIds: 'x' }, NOW).memberIds).toEqual([]);
    expect(normalizeGroup({ memberIds: ['a', 1, null, 'b'] }, NOW).memberIds).toEqual(['a', 'b']);
  });
  it('roleOverrides 비객체면 삭제, 잘못된 값 키 제거', () => {
    expect('roleOverrides' in normalizeGroup({ roleOverrides: 'x' }, NOW)).toBe(false);
    expect(normalizeGroup({ roleOverrides: { a: 'to', b: 'bcc', c: 3, d: 'cc' } }, NOW).roleOverrides).toEqual({ a: 'to', d: 'cc' });
  });
});

describe('dedupeDefault', () => {
  const g = (id: string, isDefault: boolean): Group => ({ id, name: id, memberIds: [], isDefault, updatedAt: NOW });
  it('여러 기본 중 첫 번째만 유지', () => {
    expect(dedupeDefault([g('a', false), g('b', true), g('c', true)]).map((x) => x.isDefault)).toEqual([false, true, false]);
  });
  it('기본 없으면 그대로', () => {
    expect(dedupeDefault([g('a', false)]).map((x) => x.isDefault)).toEqual([false]);
  });
});
