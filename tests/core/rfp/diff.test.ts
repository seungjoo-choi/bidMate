import { describe, expect, it } from 'vitest';
import { diffLines, diffWords, lineStats } from '../../../src/core/rfp/diff';
import { numberTokens } from '../../../src/core/rfp/normalize';

describe('diffWords', () => {
  it('바뀐 조각은 fine 이고 eq 를 이으면 공통부분', () => {
    const segs = diffWords('응답 시간 3초 이내', '응답 시간 2초 이내');
    const changed = segs.filter((s) => s.op !== 'eq');
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((s) => s.fine === true)).toBe(true);
    expect(segs.filter((s) => s.op === 'eq').map((s) => s.text).join('')).toBe('응답 시간 초 이내');
  });
  it.each([
    ['응답 시간 3초 이내', '응답 시간 2초 이내'],
    ['시스템을 구축한다', '시스템을 구축하고 운영한다'],
    ['', '새 문장'],
    ['지워진 문장', ''],
    ['가 나  다\t라', '가 다 마 라'],
    ['완전히 다른 첫 문장입니다', '전혀 상관없는 두번째 글'],
  ])('원문 복원 불변식: %s → %s', (a, b) => {
    const segs = diffWords(a, b);
    expect(segs.filter((s) => s.op !== 'ins').map((s) => s.text).join('')).toBe(a);
    expect(segs.filter((s) => s.op !== 'del').map((s) => s.text).join('')).toBe(b);
  });
});

describe('diffLines', () => {
  it('글머리·공백 차이는 같은 줄(eq)', () => {
    const ops = diffLines('ㅇ 시스템을 구축한다\n- 운영 교육을 실시한다', '- 시스템을  구축한다\nㅇ 운영 교육을 실시한다');
    expect(ops.map((o) => o.op)).toEqual(['eq', 'eq']);
  });
  it('한 단어만 바뀐 줄은 mod(segs 포함)', () => {
    const ops = diffLines('시스템은 사용자 인증을 지원해야 한다', '시스템은 관리자 인증을 지원해야 한다');
    expect(ops).toHaveLength(1);
    const o = ops[0]!;
    expect(o.op).toBe('mod');
    if (o.op === 'mod') expect(o.segs.length).toBeGreaterThan(0);
  });
  it('완전히 다른 줄은 del + ins', () => {
    const ops = diffLines('가나다라마바사', 'ABCDEFG 123');
    expect(ops.map((o) => o.op)).toEqual(['del', 'ins']);
  });
});

describe('diffLines 대량', () => {
  it('H. 완전히 다른 150줄 × 150줄은 1초 안에 del 150 + ins 150', () => {
    const mk = (base: number, i: number) => Array.from({ length: 8 }, (_, k) => String.fromCharCode(base + i * 10 + k)).join('');
    const a = Array.from({ length: 150 }, (_, i) => mk(0xac00, i)).join('\n');
    const b = Array.from({ length: 150 }, (_, i) => mk(0xc000, i)).join('\n');
    const t0 = performance.now();
    const ops = diffLines(a, b);
    expect(performance.now() - t0).toBeLessThan(1000);
    const s = lineStats(ops);
    expect(s).toEqual({ add: 150, del: 150, mod: 0 });
  });
});

describe('numberTokens 끝 마침표', () => {
  it('I. "2.0." 과 "2.0" 은 같다', () => {
    expect([...numberTokens('2.0.')]).toEqual([...numberTokens('2.0')]);
  });
});

describe('lineStats', () => {
  it('add/del/mod 카운트', () => {
    const ops = diffLines('같은 줄입니다\n시스템은 사용자 인증을 지원해야 한다\n삭제될 전혀 다른 줄', '같은 줄입니다\n시스템은 관리자 인증을 지원해야 한다\nABC XYZ 123');
    const s = lineStats(ops);
    expect(s).toEqual({ add: 1, del: 1, mod: 1 });
  });
});
