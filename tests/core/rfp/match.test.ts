import { describe, expect, it } from 'vitest';
import { compareSets } from '../../../src/core/rfp/match';
import { parseReqId } from '../../../src/core/rfp/ids';
import type { RequirementItem } from '../../../src/core/types/rfp';

/** id("SFR-001") 로 RequirementItem 을 만든다. */
function item(id: string, name: string, detail?: string, definition?: string): RequirementItem {
  const p = parseReqId(id)!;
  return {
    id: p.raw, key: p.key, prefix: p.prefix, seq: p.seq, ...(p.sub !== undefined ? { sub: p.sub } : {}),
    name, ...(definition ? { definition } : {}), ...(detail ? { detail } : {}), form: 'card', loc: { line: 0 },
  };
}

const BODY = '시스템은 사용자 인증을 지원해야 하며 모든 접속 이력을 기록하고 관리해야 한다.';

describe('compareSets', () => {
  it('1. 같은 번호·같은 내용 → same, matchedBy id', () => {
    const r = compareSets([item('SFR-001', '로그인', BODY)], [item('SFR-001', '로그인', BODY)]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.status).toBe('same');
    expect(r.pairs[0]!.matchedBy).toBe('id');
    expect(r.pairs[0]!.tags).toEqual([]);
  });

  it('2. 띄어쓰기·문장부호만 다름 → same + format', () => {
    const r = compareSets(
      [item('SFR-001', '로그인', '사용자는 시스템에 로그인할 수 있어야 한다.')],
      [item('SFR-001', '로그인', '사용자는 시스템에 로그인 할 수 있어야 한다')],
    );
    expect(r.pairs[0]!.status).toBe('same');
    expect(r.pairs[0]!.tags).toContain('format');
  });

  it('3. 본문 일부 단어 변경 → changed', () => {
    const r = compareSets(
      [item('SFR-001', '로그인', BODY)],
      [item('SFR-001', '로그인', BODY.replace('사용자', '관리자'))],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.status).toBe('changed');
  });

  it('4. 번호만 다르고 명칭·본문 같음 → changed + renumbered·number_only (similarity)', () => {
    const r = compareSets([item('SFR-001', '로그인', BODY)], [item('SFR-005', '로그인', BODY)]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.status).toBe('changed');
    expect(r.pairs[0]!.matchedBy).toBe('similarity');
    expect(r.pairs[0]!.tags).toEqual(expect.arrayContaining(['renumbered', 'number_only']));
  });

  it('5. 같은 번호지만 내용이 전혀 다름 → removed + added, id_collision', () => {
    const r = compareSets(
      [item('SFR-001', '로그인', '가나다라마바사아자차카타파하 가나다라')],
      [item('SFR-001', '백업저장소', 'ABCDEFGHIJKLMN OPQRSTUV')],
    );
    expect(r.pairs).toHaveLength(2);
    const rm = r.pairs.find((p) => p.status === 'removed')!;
    const ad = r.pairs.find((p) => p.status === 'added')!;
    expect(rm.tags).toContain('id_collision');
    expect(ad.tags).toContain('id_collision');
  });

  it('6. 명칭이 약간 비슷(0.5~0.7)하고 본문 다름 → changed + weak', () => {
    const r = compareSets(
      [item('SFR-001', '사용자관리', '가나다라마바사아자차카타파하')],
      [item('SFR-001', '사용자등록', 'ABCDEFGHIJKLMNOPQRSTUV')],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.status).toBe('changed');
    expect(r.pairs[0]!.tags).toContain('weak');
  });

  it('7. 숫자만 바뀜 → changed + numeric', () => {
    const base = '응답 시간은 3초 이내여야 하며 동시 사용자 처리를 지원하고 장애 시 자동 복구해야 한다.';
    const r = compareSets([item('PER-001', '응답시간', base)], [item('PER-001', '응답시간', base.replace('3초', '2초'))]);
    expect(r.pairs[0]!.status).toBe('changed');
    expect(r.pairs[0]!.tags).toContain('numeric');
  });

  it('8. override pair 로 다른 두 항목 강제 짝 → manual', () => {
    const r = compareSets(
      [item('SFR-001', '로그인', '가나다라마바사아자차카타파하')],
      [item('SFR-009', '결제', 'ABCDEFGHIJKLMNOPQRSTUV')],
      [{ op: 'pair', prevKey: 'SFR-001', nextKey: 'SFR-009' }],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.matchedBy).toBe('manual');
    expect(r.pairs[0]!.prev!.key).toBe('SFR-001');
    expect(r.pairs[0]!.next!.key).toBe('SFR-009');
  });

  it('9. override unpair 로 같은 번호 짝 금지 → removed + added', () => {
    const r = compareSets(
      [item('SFR-001', '로그인', BODY)],
      [item('SFR-001', '로그인', BODY)],
      [{ op: 'unpair', prevKey: 'SFR-001', nextKey: 'SFR-001' }],
    );
    expect(r.counts).toEqual({ same: 0, changed: 0, added: 1, removed: 1 });
  });

  it('10. 이전 2개 본문이 이번 1개 본문에 포함 → 이전 2개 removed + merged', () => {
    const x = '시스템은 사용자 인증을 지원해야 하며 모든 접속 이력을 기록해야 한다.';
    const y = '백업은 매일 새벽에 자동으로 수행되고 보관 기간은 별도로 협의하여 정한다.';
    const r = compareSets(
      [item('SFR-001', '로그인', x), item('SFR-002', '백업', y)],
      [item('SFR-010', '통합 관리 기능', `${x}\n${y}`)],
    );
    const removed = r.pairs.filter((p) => p.status === 'removed');
    expect(removed).toHaveLength(2);
    for (const p of removed) {
      expect(p.tags).toContain('merged');
      expect(p.group).toEqual({ kind: 'merged', keys: ['SFR-010'] });
    }
  });

  it('11. 결정성: 같은 입력 두 번 → toEqual', () => {
    const prev = [item('SFR-001', '로그인', BODY), item('PER-001', '응답시간', '3초 이내 처리'), item('COR-001', '표준', '표준을 준수한다')];
    const next = [item('SFR-002', '로그인', BODY), item('PER-001', '응답시간', '2초 이내 처리'), item('SER-001', '보안', '암호화를 적용한다')];
    expect(compareSets(prev, next)).toEqual(compareSets(prev, next));
  });

  it('12. counts 합 = pairs 길이, 정렬은 접두어→번호 순', () => {
    const prev = [item('SFR-010', '로그인', BODY), item('PER-002', '응답시간', '3초 이내 처리'), item('SFR-002', '검색', '검색 결과를 표시한다'), item('COR-001', '표준', '표준을 준수한다')];
    const next = [item('SFR-010', '로그인', BODY), item('PER-002', '응답시간', '2초 이내 처리'), item('SFR-003', '통계', '통계 화면을 제공한다'), item('SER-001', '보안', '암호화를 적용한다')];
    const r = compareSets(prev, next);
    const c = r.counts;
    expect(c.same + c.changed + c.added + c.removed).toBe(r.pairs.length);
    const refs = r.pairs.map((p) => (p.next ?? p.prev)!);
    const sorted = [...refs].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.seq - b.seq);
    expect(refs.map((i) => i.key)).toEqual(sorted.map((i) => i.key));
    expect(r.prefixes).toEqual([...r.prefixes].sort());
  });

  it('D. 본문이 양쪽 다 빈 같은 번호인데 명칭이 다르면 짝 안 됨(id_collision)', () => {
    const r = compareSets([item('SFR-001', '로그인')], [item('SFR-001', '통계 보고서')]);
    expect(r.pairs).toHaveLength(2);
    const rm = r.pairs.find((p) => p.status === 'removed')!;
    const ad = r.pairs.find((p) => p.status === 'added')!;
    expect(rm.tags).toContain('id_collision');
    expect(ad.tags).toContain('id_collision');
  });

  it('E. 본문 빈 항목끼리 번호도 명칭도 다르면 짝 안 됨', () => {
    const r = compareSets([item('SFR-010', '회원 가입')], [item('SFR-020', '회원 탈퇴')]);
    expect(r.counts).toEqual({ same: 0, changed: 0, added: 1, removed: 1 });
  });

  it('F. 번호 충돌 항목이 2단계에서 다른 번호와 짝지어지면 id_collision + renumbered', () => {
    const X = '시스템은 사용자 인증을 지원해야 하며 모든 접속 이력을 기록하고 관리해야 한다.';
    const Y = '백업은 매일 새벽에 자동으로 수행되고 보관 기간은 별도로 협의하여 정한다.';
    const r = compareSets(
      [item('SFR-001', '로그인', X)],
      [item('SFR-001', '통계', Y), item('SFR-005', '로그인', X)],
    );
    const p = r.pairs.find((x) => x.prev?.key === 'SFR-001' && x.next?.key === 'SFR-005')!;
    expect(p).toBeDefined();
    expect(p.matchedBy).toBe('similarity');
    expect(p.tags).toContain('id_collision');
    expect(p.tags).toContain('renumbered');
  });

  it('G. 문장 끝 마침표 차이는 numeric 이 아니다', () => {
    const r = compareSets(
      [item('SFR-001', '버전', '시스템은 버전 2.0 이상.')],
      [item('SFR-001', '버전', '시스템은 버젼 2.0 이상')],
    );
    expect(r.pairs[0]!.status).toBe('changed');
    expect(r.pairs[0]!.tags).not.toContain('numeric');
  });
});

describe('compareSets: 항목 삭제로 번호가 당겨짐(실측 출연연 NFIS)', () => {
  it('번호만 같은 짝보다 내용이 같은 짝이 이긴다', () => {
    const X = '사전 서면동의 없이 본 계약서에 따른 권리와 의무를 타인에게 양도할 수 없다.\n용역 수행 상 발생하는 문제점을 연구회에 보고하고 조치사항에 응하여야 함';
    const Y = '제안서의 효력\n제안서에 제시된 내용은 계약서에 명시되지 않았더라도 계약서와 동일한 효력을 가진다.';
    const prev = [item('COR-003', '데이터베이스 표준화', '공공기관의 데이터베이스 표준화지침을 준수하여야 함'), item('COR-005', '특수조건 사항(1)', X), item('COR-006', '특수조건 사항(2)', Y)];
    const next = [item('COR-004', '특수조건 사항(1)', X), item('COR-005', '특수조건 사항(2)', Y), item('COR-006', '대가 지급', '용역수행 대가의 지급은 매월 월간보고서를 검토하여 지급')];
    const r = compareSets(prev, next);
    const byKey = (k: string) => r.pairs.find((p) => p.key === k);
    expect(byKey('COR-005|COR-004')?.status).toBe('changed');
    expect(byKey('COR-005|COR-004')?.tags).toEqual(expect.arrayContaining(['renumbered', 'number_only']));
    expect(byKey('COR-006|COR-005')?.status).toBe('changed');
    expect(byKey('COR-003|-')?.status).toBe('removed');
    expect(byKey('-|COR-006')?.status).toBe('added');
    expect(r.counts).toEqual({ same: 0, changed: 2, added: 1, removed: 1 });
  });
});
