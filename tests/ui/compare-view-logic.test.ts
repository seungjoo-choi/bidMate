import { describe, expect, it } from 'vitest';
import { compareSets } from '../../src/core/rfp/match';
import type { RequirementItem, RfpCompareSession, RfpPair, RfpPairStatus, RfpPairTag } from '../../src/core/types/rfp';
import {
  addPairOverride, addUnpairOverride, DEFAULT_FILTER, filterPairs, hiddenSameCount, hintsOf, nextSelectionAfterRemoval, nextUnreviewedKey, swapSessionDirection,
  type CompareFilter,
} from '../../src/entrypoints/dashboard/rfp/compare-view-logic';

const item = (id: string, name: string, extra: Partial<RequirementItem> = {}): RequirementItem => {
  const [prefix, n] = id.split('-');
  return { id, key: id, prefix: prefix!, seq: Number(n), name, form: 'card', loc: { line: 0 }, ...extra };
};
const pair = (status: RfpPairStatus, id: string, name: string, tags: RfpPairTag[] = []): RfpPair => {
  const it = item(id, name);
  return { key: status === 'added' ? `-|${id}` : status === 'removed' ? `${id}|-` : `${id}|${id}`, status, tags, ...(status !== 'added' ? { prev: it } : {}), ...(status !== 'removed' ? { next: it } : {}) };
};

const P = [
  pair('changed', 'SFR-001', '로그인', ['numeric']),
  pair('same', 'SFR-002', '조회'),
  pair('added', 'PER-001', '응답 시간'),
  pair('removed', 'PER-002', '동시 접속'),
  pair('changed', 'SER-001', '암호화'),
];
const f = (patch: Partial<CompareFilter> = {}): CompareFilter => ({ ...DEFAULT_FILTER, ...patch });
const keys = (ps: RfpPair[]) => ps.map((p) => p.key);
const none = new Set<string>();

describe('filterPairs', () => {
  it('기본값은 동일을 숨긴다', () => {
    expect(keys(filterPairs(P, f(), none))).toEqual(['SFR-001|SFR-001', '-|PER-001', 'PER-002|-', 'SER-001|SER-001']);
  });
  it('상태 토글을 모두 끄면 비어 있다', () => {
    expect(filterPairs(P, f({ status: { changed: false, added: false, removed: false, same: false } }), none)).toEqual([]);
  });
  it('접두어 + 검색(번호·명칭)을 함께 건다', () => {
    expect(keys(filterPairs(P, f({ prefix: 'PER' }), none))).toEqual(['-|PER-001', 'PER-002|-']);
    expect(keys(filterPairs(P, f({ query: '동시' }), none))).toEqual(['PER-002|-']);
    expect(keys(filterPairs(P, f({ query: 'per-001', prefix: 'PER' }), none))).toEqual(['-|PER-001']);
    expect(filterPairs(P, f({ query: 'per-001', prefix: 'SFR' }), none)).toEqual([]);
  });
  it('수치 바뀐 것만은 numeric 태그만 남긴다', () => {
    expect(keys(filterPairs(P, f({ numericOnly: true }), none))).toEqual(['SFR-001|SFR-001']);
  });
  it('미확인만은 확인함과 동일을 뺀다', () => {
    const r = new Set(['PER-002|-', 'SFR-001|SFR-001']);
    expect(keys(filterPairs(P, f({ todoOnly: true }), r))).toEqual(['-|PER-001', 'SER-001|SER-001']);
    expect(keys(filterPairs(P, f({ todoOnly: true, status: { ...DEFAULT_FILTER.status, same: true } }), r))).not.toContain('SFR-002|SFR-002');
  });
  it('수치만 + 미확인만 + 접두어 조합', () => {
    expect(keys(filterPairs(P, f({ numericOnly: true, todoOnly: true, prefix: 'SFR' }), none))).toEqual(['SFR-001|SFR-001']);
    expect(filterPairs(P, f({ numericOnly: true, todoOnly: true }), new Set(['SFR-001|SFR-001']))).toEqual([]);
  });
});

describe('hiddenSameCount', () => {
  const many = [...P, pair('same', 'PER-003', '로그'), pair('same', 'SER-002', '감사')];
  it('동일을 숨기면 동일 개수를 센다', () => { expect(hiddenSameCount(many, f())).toBe(3); });
  it('동일을 보이는 중이면 0', () => { expect(hiddenSameCount(many, f({ status: { ...DEFAULT_FILTER.status, same: true } }))).toBe(0); });
  it('접두어·검색을 적용한다', () => {
    expect(hiddenSameCount(many, f({ prefix: 'PER' }))).toBe(1);
    expect(hiddenSameCount(many, f({ query: '감사' }))).toBe(1);
  });
});

describe('nextUnreviewedKey', () => {
  const vis = P.filter((p) => p.status !== 'same'); /* S1, A, R, S2 */
  it('현재 다음의 미확인을 돌려준다', () => {
    expect(nextUnreviewedKey(vis, none, 'SFR-001|SFR-001')).toBe('-|PER-001');
  });
  it('확인함은 건너뛴다', () => {
    expect(nextUnreviewedKey(vis, new Set(['-|PER-001']), 'SFR-001|SFR-001')).toBe('PER-002|-');
  });
  it('끝에서 처음으로 순환한다', () => {
    expect(nextUnreviewedKey(vis, none, 'SER-001|SER-001')).toBe('SFR-001|SFR-001');
  });
  it('동일은 건너뛴다', () => {
    expect(nextUnreviewedKey(P, new Set(['SFR-001|SFR-001']), 'SFR-001|SFR-001')).toBe('-|PER-001');
  });
  it('현재가 목록에 없거나 null이면 처음부터', () => {
    expect(nextUnreviewedKey(vis, none, null)).toBe('SFR-001|SFR-001');
    expect(nextUnreviewedKey(vis, none, 'zzz')).toBe('SFR-001|SFR-001');
  });
  it('현재만 남았으면 현재를 돌려주고, 전부 확인했으면 null', () => {
    expect(nextUnreviewedKey(vis, new Set(['SFR-001|SFR-001', '-|PER-001', 'PER-002|-']), 'SER-001|SER-001')).toBe('SER-001|SER-001');
    expect(nextUnreviewedKey(vis, new Set(vis.map((p) => p.key)), 'SER-001|SER-001')).toBeNull();
    expect(nextUnreviewedKey([], none, null)).toBeNull();
  });
});

describe('swapSessionDirection', () => {
  const s: RfpCompareSession = {
    schemaVersion: 1, id: 'c1', createdAt: '', updatedAt: '',
    prev: { ref: { kind: 'upload', uploadId: 'a' }, title: 'A' }, next: { ref: { kind: 'upload', uploadId: 'b' }, title: 'B' },
    overrides: [{ op: 'pair', prevKey: 'SFR-001', nextKey: 'SFR-009' }, { op: 'unpair', prevKey: 'PER-001', nextKey: 'PER-001' }],
    reviewed: ['SFR-001|SFR-009'],
  };
  it('문서를 맞바꾸고 overrides 키를 교체하며 확인함을 비운다', () => {
    const r = swapSessionDirection(s);
    expect(r.prev.title).toBe('B');
    expect(r.next.title).toBe('A');
    expect(r.overrides).toEqual([{ op: 'pair', prevKey: 'SFR-009', nextKey: 'SFR-001' }, { op: 'unpair', prevKey: 'PER-001', nextKey: 'PER-001' }]);
    expect(r.reviewed).toEqual([]);
  });
  it('두 번 바꾸면 원래 문서·overrides로 돌아온다', () => {
    const r = swapSessionDirection(swapSessionDirection(s));
    expect(r.prev).toEqual(s.prev);
    expect(r.overrides).toEqual(s.overrides);
  });
});

describe('수동 짝 overrides', () => {
  it('pair 추가 시 같은 키 쌍의 unpair를 제거한다', () => {
    const r = addPairOverride([{ op: 'unpair', prevKey: 'A-001', nextKey: 'A-001' }, { op: 'unpair', prevKey: 'B-001', nextKey: 'B-001' }], 'A-001', 'A-001');
    expect(r).toEqual([{ op: 'unpair', prevKey: 'B-001', nextKey: 'B-001' }, { op: 'pair', prevKey: 'A-001', nextKey: 'A-001' }]);
  });
  it('unpair 추가 시 같은 키 쌍의 pair를 제거하고 중복을 만들지 않는다', () => {
    const r = addUnpairOverride([{ op: 'pair', prevKey: 'A-001', nextKey: 'A-002' }], 'A-001', 'A-002');
    expect(r).toEqual([{ op: 'unpair', prevKey: 'A-001', nextKey: 'A-002' }]);
    expect(addUnpairOverride(r, 'A-001', 'A-002')).toEqual(r);
  });
  it('방향을 바꿔도 같은 짝이 유지된다(compareSets)', () => {
    const a = [item('SFR-001', '로그인 기능', { definition: '아이디와 비밀번호로 로그인한다' })];
    const b = [item('SFR-009', '전혀 다른 이름의 항목', { definition: '완전히 다른 설명 문장이 들어간다' })];
    const ov = [{ op: 'pair' as const, prevKey: 'SFR-001', nextKey: 'SFR-009' }];
    const fwd = compareSets(a, b, ov);
    const back = compareSets(b, a, ov.map((o) => ({ ...o, prevKey: o.nextKey, nextKey: o.prevKey })));
    expect(fwd.pairs).toHaveLength(1);
    expect(back.pairs).toHaveLength(1);
    expect(back.pairs[0]!.matchedBy).toBe('manual');
  });
});

describe('hintsOf', () => {
  it('태그에 맞는 힌트를 만든다', () => {
    const p = { ...pair('changed', 'SFR-001', 'x', ['renumbered', 'numeric', 'minor']) };
    expect(hintsOf(p).map((h) => h.id)).toEqual(['ren', 'num', 'minor']);
  });
  it('weak면 major 대신 다른 항목일 수도만 보인다', () => {
    expect(hintsOf(pair('changed', 'SFR-001', 'x', ['weak', 'major'])).map((h) => h.id)).toEqual(['weak']);
    expect(hintsOf(pair('changed', 'SFR-001', 'x', ['major'])).map((h) => h.id)).toEqual(['major']);
  });
  it('minor가 아닌 변경은 줄 통계 칩을 단다', () => {
    const prev = item('SFR-001', '로그인', { detail: '첫째 줄\n둘째 줄' });
    const next = item('SFR-001', '로그인', { detail: '첫째 줄\n둘째 줄\n완전히 새로운 셋째 줄' });
    const p: RfpPair = { key: 'SFR-001|SFR-001', status: 'changed', prev, next, tags: [] };
    const h = hintsOf(p).find((x) => x.id === 'lines');
    expect(h?.stats).toEqual({ mod: 0, add: 1, del: 0 });
    expect(hintsOf({ ...p, tags: ['minor'] }).some((x) => x.id === 'lines')).toBe(false);
  });
});

describe('nextSelectionAfterRemoval', () => {
  it('빠진 항목의 다음 보이는 항목으로 옮긴다', () => {
    expect(nextSelectionAfterRemoval(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd'])).toBe('c');
    expect(nextSelectionAfterRemoval(['a', 'b', 'c', 'd'], 'b', ['a', 'd'])).toBe('d');
  });
  it('뒤에 없으면 앞쪽 가까운 항목, 아무것도 없으면 null', () => {
    expect(nextSelectionAfterRemoval(['a', 'b', 'c'], 'c', ['a', 'b'])).toBe('b');
    expect(nextSelectionAfterRemoval(['a'], 'a', [])).toBeNull();
    expect(nextSelectionAfterRemoval(['a'], 'zzz', ['a'])).toBeNull();
  });
});
