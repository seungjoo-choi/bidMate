import { describe, expect, it } from 'vitest';
import {
  buildImportPlan, defaultSelection, diffContacts, domainIdFrom, parseNwUsers, planCount,
  type NwContact,
} from '../../src/core/recipients/naverworks-contacts';
import type { Recipient } from '../../src/core/types/recipient';

const rcp = (o: Partial<Recipient> & { id: string; email: string }): Recipient => ({
  name: '이름', enabled: true, defaultRole: 'to', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
});
const con = (o: Partial<NwContact> & { email: string; name: string }): NwContact => ({
  rawEmail: o.email, flagged: false, ...o,
});

describe('domainIdFrom', () => {
  it('전체 URL', () => {
    expect(domainIdFrom('https://contact.worksmobile.com/p/web/domain/133918')).toBe('133918');
  });
  it('숫자만', () => {
    expect(domainIdFrom(' 133918 ')).toBe('133918');
  });
  it('경로 뒤 쿼리', () => {
    expect(domainIdFrom('/p/web/domain/133918?foo=1#x')).toBe('133918');
  });
  it('없으면 null', () => {
    expect(domainIdFrom('https://contact.worksmobile.com/')).toBeNull();
    expect(domainIdFrom('abc')).toBeNull();
    expect(domainIdFrom('')).toBeNull();
  });
});

describe('parseNwUsers', () => {
  it('정상 매핑: orgUnits를 " / "로 결합', () => {
    const r = parseNwUsers([{ name: ' 홍길동 ', email: 'Hong@Corp.com', orgUnits: ['본사', ' 영업팀 '], orgUnitName: '영업팀', positionName: '과장' }]);
    expect(r.contacts).toEqual([{ email: 'hong@corp.com', rawEmail: 'Hong@Corp.com', name: '홍길동', dept: '본사 / 영업팀', flagged: false, positionName: '과장' }]);
  });
  it('orgUnits 없음 → orgUnitName', () => {
    expect(parseNwUsers([{ name: 'a', email: 'a@b.com', orgUnitName: '영업팀' }]).contacts[0]!.dept).toBe('영업팀');
  });
  it('둘 다 없음 → undefined', () => {
    const c = parseNwUsers([{ name: 'a', email: 'a@b.com', orgUnits: [] }]).contacts[0]!;
    expect(c.dept).toBeUndefined();
  });
  it('email 없음·형식 오류는 skip', () => {
    const r = parseNwUsers([{ name: 'a' }, { name: 'b', email: 'bad' }, { name: 'c', email: 123 }, { name: 'd', email: 'd@b.com' }]);
    expect(r.contacts).toHaveLength(1);
    expect(r.skippedNoEmail).toBe(3);
  });
  it('대소문자만 다른 중복은 1건', () => {
    const r = parseNwUsers([{ name: 'a', email: 'A@b.com' }, { name: 'b', email: 'a@B.com' }]);
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]!.name).toBe('a');
    expect(r.duplicateEmails).toBe(1);
  });
  it('이름 빈 값 → 이메일 로컬파트', () => {
    expect(parseNwUsers([{ name: '  ', email: 'kim.s@b.com' }]).contacts[0]!.name).toBe('kim.s');
    expect(parseNwUsers([{ email: 'lee@b.com' }]).contacts[0]!.name).toBe('lee');
  });
  it('이름 101자·부서 201자 절단', () => {
    const c = parseNwUsers([{ name: 'n'.repeat(101), email: 'a@b.com', orgUnitName: 'd'.repeat(201) }]).contacts[0]!;
    expect(c.name).toHaveLength(100);
    expect(c.dept).toHaveLength(200);
  });
  it('절단 지점이 공백이면 끝 공백 제거', () => {
    const c = parseNwUsers([{ name: 'n'.repeat(99) + ' x', email: 'a@b.com', orgUnitName: 'd'.repeat(199) + ' x' }]).contacts[0]!;
    expect(c.name).toBe('n'.repeat(99));
    expect(c.dept).toBe('d'.repeat(199));
  });
  it('flagged: orgUnitName 휴직', () => {
    const c = parseNwUsers([{ name: 'a', email: 'a@b.com', orgUnitName: '휴직' }]).contacts[0]!;
    expect(c.flagged).toBe(true);
    expect(c.flagReason).toBe('휴직');
  });
  it('flagged: orgUnits 중간 원소 협력사', () => {
    const c = parseNwUsers([{ name: 'a', email: 'a@b.com', orgUnits: ['본사', '협력사', '팀'], orgUnitName: '팀' }]).contacts[0]!;
    expect(c.flagged).toBe(true);
    expect(c.flagReason).toBe('협력사');
  });
  it('flagged: 휴직자는 false', () => {
    const c = parseNwUsers([{ name: 'a', email: 'a@b.com', orgUnitName: '휴직자' }]).contacts[0]!;
    expect(c.flagged).toBe(false);
    expect(c.flagReason).toBeUndefined();
  });
  it('배열 아님 → 빈 결과', () => {
    expect(parseNwUsers(null)).toEqual({ contacts: [], skippedNoEmail: 0, duplicateEmails: 0 });
    expect(parseNwUsers({})).toEqual({ contacts: [], skippedNoEmail: 0, duplicateEmails: 0 });
  });
});

describe('diffContacts', () => {
  it('새 사람', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'A' })], []);
    expect(d.added).toHaveLength(1);
    expect(d.changed).toHaveLength(0);
  });
  it('이름만 다름', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'New', dept: 'X' })], [rcp({ id: 'r1', email: 'a@b.com', name: 'Old', dept: 'X' })]);
    expect(d.changed[0]!.fields).toEqual(['name']);
  });
  it('부서만 다름', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'A', dept: 'Y' })], [rcp({ id: 'r1', email: 'a@b.com', name: 'A', dept: 'X' })]);
    expect(d.changed[0]!.fields).toEqual(['dept']);
  });
  it('이름·부서 둘 다 다름', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'B', dept: 'Y' })], [rcp({ id: 'r1', email: 'a@b.com', name: 'A' })]);
    expect(d.changed[0]!.fields).toEqual(['name', 'dept']);
  });
  it('기존 dept 있고 NW 없음 → changed', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'A' })], [rcp({ id: 'r1', email: 'a@b.com', name: 'A', dept: 'X' })]);
    expect(d.changed[0]!.fields).toEqual(['dept']);
  });
  it('같으면 unchanged, 대소문자 다른 이메일도 매칭', () => {
    const d = diffContacts([con({ email: 'a@b.com', name: 'A' })], [rcp({ id: 'r1', email: ' A@B.com ', name: ' A ' })]);
    expect(d.unchanged).toBe(1);
    expect(d.added).toHaveLength(0);
    expect(d.missing).toHaveLength(0);
  });
  it('목록 없음 + enabled → missing', () => {
    const d = diffContacts([], [rcp({ id: 'r1', email: 'a@b.com' })]);
    expect(d.missing.map((r) => r.id)).toEqual(['r1']);
  });
  it('목록 없음 + disabled → missingAlreadyDisabled', () => {
    const d = diffContacts([], [rcp({ id: 'r1', email: 'a@b.com', enabled: false })]);
    expect(d.missing).toHaveLength(0);
    expect(d.missingAlreadyDisabled).toBe(1);
  });
  it('정렬: 부서(빈 값 뒤) → 이름, missing은 이름', () => {
    const d = diffContacts([
      con({ email: 'n@b.com', name: '가', }),
      con({ email: 'b@b.com', name: '나', dept: '영업' }),
      con({ email: 'a@b.com', name: '가', dept: '영업' }),
      con({ email: 'c@b.com', name: '다', dept: '개발' }),
    ], [rcp({ id: 'r2', email: 'x2@b.com', name: '하' }), rcp({ id: 'r1', email: 'x1@b.com', name: '가' })]);
    expect(d.added.map((c) => c.email)).toEqual(['c@b.com', 'a@b.com', 'b@b.com', 'n@b.com']);
    expect(d.missing.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('defaultSelection / buildImportPlan', () => {
  const recs = [
    rcp({ id: 'r1', email: 'old@b.com', name: 'Old', dept: 'X' }),
    rcp({ id: 'r2', email: 'flag@b.com', name: 'F' }),
    rcp({ id: 'r3', email: 'gone@b.com', name: 'G' }),
  ];
  const contacts = [
    con({ email: 'old@b.com', name: 'New' }),
    con({ email: 'flag@b.com', name: 'F2', flagged: true, flagReason: '휴직' }),
    con({ email: 'new@b.com', name: 'N', dept: 'D' }),
    con({ email: 'nf@b.com', name: 'NF', flagged: true, flagReason: '협력사' }),
  ];
  const diff = diffContacts(contacts, recs);

  it('defaultSelection: flagged 제외, missing 비움', () => {
    const s = defaultSelection(diff);
    expect([...s.added]).toEqual(['new@b.com']);
    expect([...s.changed]).toEqual(['r1']);
    expect(s.missing.size).toBe(0);
  });
  it('buildImportPlan: 선택만, dept 키 생략, 정규화 이메일', () => {
    const plan = buildImportPlan(diff, {
      added: new Set(['new@b.com', 'nf@b.com']),
      changed: new Set(['r1']),
      missing: new Set(['r3']),
    });
    expect(plan.add).toEqual([
      { name: 'N', email: 'new@b.com', dept: 'D' },
      { name: 'NF', email: 'nf@b.com' },
    ]);
    expect(plan.add[1]!).not.toHaveProperty('dept');
    expect(plan.update).toEqual([{ id: 'r1', name: 'New' }]);
    expect(plan.update[0]!).not.toHaveProperty('dept');
    expect(plan.disable).toEqual(['r3']);
    expect(planCount(plan)).toBe(4);
  });
  it('buildImportPlan: 미선택은 제외', () => {
    const plan = buildImportPlan(diff, { added: new Set(), changed: new Set(), missing: new Set() });
    expect(planCount(plan)).toBe(0);
  });
});
