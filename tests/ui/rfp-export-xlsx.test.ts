// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseReqId } from '../../src/core/rfp/ids';
import { compareSets } from '../../src/core/rfp/match';
import type { RequirementItem } from '../../src/core/types/rfp';
import { buildCompareXlsx, changeRuns, exportFileName } from '../../src/entrypoints/dashboard/rfp/export-xlsx';

function item(id: string, name: string, detail?: string): RequirementItem {
  const p = parseReqId(id)!;
  return { id: p.raw, key: p.key, prefix: p.prefix, seq: p.seq, name, ...(detail ? { detail } : {}), form: 'card', loc: { line: 0 } };
}
const BODY = '시스템은 사용자 인증을 지원해야 하며 모든 접속 이력을 기록하고 관리해야 한다.';
const result = compareSets(
  [item('SFR-001', '로그인', BODY), item('SFR-002', '검색 <고급>', '검색 결과를 표시한다'), item('COR-003', '표준', '표준을 준수한다'), item('SFR-009', '백업', '품명\t규격\t수량')],
  [item('SFR-001', '로그인', BODY.replace('사용자', '관리자')), item('SFR-002', '검색 <고급>', '검색 결과를 표시한다'), item('SER-001', '보안', '암호화를 적용한다'), item('SFR-010', '백업', '품명\t규격\t수량')],
);
const at = new Date(2026, 9, 21, 9, 5);

function open(scope: 'changed' | 'all') {
  const z = unzipSync(buildCompareXlsx({ result, scope, prevTitle: '2026 사업', nextTitle: '2027 사업 & 유지', at }));
  const xml = (p: string) => strFromU8(z[p]!);
  return { z, xml, doc: (p: string) => new DOMParser().parseFromString(xml(p), 'application/xml') };
}

describe('buildCompareXlsx', () => {
  it('세 시트와 서식 파일이 있고 모든 XML이 올바르다', () => {
    const { z, doc } = open('changed');
    for (const p of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
      expect(z[p]).toBeDefined();
      expect(doc(p).getElementsByTagName('parsererror')).toHaveLength(0);
    }
    expect(doc('xl/workbook.xml').getElementsByTagName('sheet')).toHaveLength(3);
  });

  it('달라진 것만: 동일 행 제외 / 전체: 동일 포함', () => {
    const rows = (s: 'changed' | 'all') => open(s).doc('xl/worksheets/sheet1.xml').getElementsByTagName('row').length;
    const diff = result.counts.changed + result.counts.added + result.counts.removed;
    expect(rows('changed')).toBe(1 + diff);
    expect(rows('all')).toBe(1 + result.pairs.length);
  });

  it('특수문자는 이스케이프되고 탭은 " | "로 바뀐다', () => {
    const s1 = open('all').xml('xl/worksheets/sheet1.xml');
    expect(s1).toContain('검색 &lt;고급&gt;');
    expect(s1).toContain('품명 | 규격 | 수량');
    expect(s1).not.toContain('\t');
  });

  it('번호 대조 시트에 번호가 바뀐 항목과 한쪽에만 있는 항목이 들어간다', () => {
    const s2 = open('changed').xml('xl/worksheets/sheet2.xml');
    expect(s2).toContain('SFR-009');
    expect(s2).toContain('번호만 바뀜');
    expect(s2).toContain('COR-003');
    expect(s2).not.toContain('>SFR-002<');
  });
});

describe('changeRuns', () => {
  it('바뀐 말은 del/ins 조각으로, 칸 이름은 label', () => {
    const p = result.pairs.find((x) => x.key === 'SFR-001|SFR-001')!;
    const runs = changeRuns(p);
    expect(runs[0]).toEqual({ text: '[세부내용]\n', kind: 'label' });
    // 글자 단위로 다시 쪼개므로 공통 글자("자")는 eq로 남는다
    expect(runs.some((r) => r.kind === 'del' && r.text.includes('사용'))).toBe(true);
    expect(runs.some((r) => r.kind === 'ins' && r.text.includes('관리'))).toBe(true);
    expect(runs.filter((r) => r.kind !== 'label').map((r) => r.text).join('')).not.toContain('\n\n');
  });
  it('한쪽만 있는 항목은 비어 있다', () => {
    expect(changeRuns(result.pairs.find((x) => x.key === '-|SER-001')!)).toEqual([]);
  });
});

it('exportFileName: 금지 문자 제거와 날짜', () => {
  expect(exportFileName('2027/사업:유지', at)).toBe('RFP비교_2027 사업 유지_20261021.xlsx');
});
