import { describe, expect, it } from 'vitest';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import { decide } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';
import { flattenUnits } from '../../src/core/extraction/strategies/common';

const rules = loadRules();
const P = (text: string, i: number): DocBlock => ({ kind: 'p', text, loc: { block: i, line: i + 1 } });
const docOf = (lines: string[], extra: DocBlock[] = []): DocModel => ({
  format: 'hwp5', warnings: [], stats: { chars: 10, tables: extra.length, ms: 1 },
  blocks: [...lines.map(P), ...extra],
});
const formLines = (lines: string[], extra: DocBlock[] = []) => flattenUnits(docOf(lines, extra)).filter((u) => u.inForm).map((u) => u.text);
const extras = (lines: string[]) => decide(runRules([{ doc: docOf(lines), attachmentId: 'a', sourceFile: 'a', docKind: 'rfp', priority: 3 }], rules).candidates, rules).extras;

describe('서식 구간 표시', () => {
  it('계약서(안) 제목부터 다음 장 제목 전까지 표시', () => {
    expect(formLines(['Ⅰ. 사업 개요', '□ 사업기간 : 2027. 1. 1. ∼ 12. 31.', '표준 개인정보처리위탁 계약서(안)', '계약 기간 : 20  년  월  일 ~ 20  년  월  일', 'Ⅱ. 현황', '본문']))
      .toEqual(['표준 개인정보처리위탁 계약서(안)', '계약 기간 : 20  년  월  일 ~ 20  년  월  일']);
  });

  it('[별지 서식]·<서식 N> 제목으로 시작하고 서식 아닌 붙임 제목에서 끝남', () => {
    expect(formLines(['[별지 제1호 서식]', 'a', '□ 붙임 4. 평가항목 조견표', 'b'])).toEqual(['[별지 제1호 서식]', 'a']);
    expect(formLines(['<서식 3> 제안서 표지', 'a'])).toEqual(['<서식 3> 제안서 표지', 'a']);
  });

  it('목차 줄, 글머리 기호 줄, 본문 문장, 표 셀은 서식 제목이 아님', () => {
    const cell: DocBlock = {
      kind: 'table', index: 0, rows: 1, cols: 1, loc: { block: 9 },
      cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: '사업수행실적 확인서', blocks: [], loc: { block: 9, line: 10 } }],
    };
    expect(formLines(['붙임 3. 표준 개인정보처리위탁 계약서(안) ..... 45', '- 청렴계약 이행 서약서', '서식은 붙임 참조', '양식에 따라 작성', 'a'], [cell])).toEqual([]);
  });

  it('제출서류 나열·서식 안내 문장은 서식 제목이 아님', () => {
    expect(formLines([
      '제출서류 : 사업자등록증, 법인 인감증명서', '제출서류: 입찰참가신청서', '하도급 계획서 및 하도급 계약서', '청렴계약 이행각서',
      '입찰참가자는 다음 서류를 제출: 청렴계약 이행 서약서', '서식1에 따라 작성하여 제출', '양식', 'a',
    ])).toEqual([]);
  });

  it('표 셀 안 중첩 문단은 서식 제목이 아님', () => {
    const cell: DocBlock = {
      kind: 'table', index: 0, rows: 1, cols: 1, loc: { block: 9 },
      cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: '', blocks: [P('표준 용역 계약서(안)', 10)], loc: { block: 9, line: 10 } }],
    };
    expect(formLines(['a'], [cell])).toEqual([]);
  });

  it('번호형 별지 표지 "<별지 1>"도 서식 시작', () => {
    expect(formLines(['<별지 1>', 'a', '[별지 2] 입찰참가신청서', 'b'])).toEqual(['<별지 1>', 'a', '[별지 2] 입찰참가신청서', 'b']);
  });

  it.each([['제3장 제안요청내용'], ['[붙임 1] 과업지시서'], ['【별첨 2】 과업내용'], ['붙임'], ['붙임 1'], ['(붙임) 과업내용']])('"%s"에서 서식 구간이 끝남', (head) => {
    expect(formLines(['표준 용역 계약서(안)', 'x', head, 'y'])).toEqual(['표준 용역 계약서(안)', 'x']);
  });
});

describe('사업기간: 빈칸 서식 제외와 서식 구간 후순위', () => {
  it('빈칸 날짜("20  년  월  일")는 후보가 아님', () => {
    expect(extras(['계약 기간 : 20  년  월  일 ~ 20  년  월  일']).projectPeriod).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('본문 값과 서식 안 값이 다르면 본문 값으로 확인, 서식 값은 후보로만', () => {
    const x = extras(['□ 사업기간 : 2027. 1. 1. ∼ 12. 31.', '표준 용역 계약서(안)', '계약기간 : 2026. 3. 1. ~ 2026. 12. 31.']).projectPeriod!;
    expect(x).toMatchObject({ value: '2027. 1. 1. ∼ 12. 31.', status: 'verified' });
    expect(x.candidates?.map((c) => c.value)).toEqual(['2026. 3. 1. ~ 2026. 12. 31.']);
  });

  it.each([['계약일로부터 12개월(매월 일정 보고)'], ['2027. 1. 1. ~ 12. 31.(매년 월별 점검)'], ['2027년 3월 1일 ~ 12월 31일']])('정상 값 "%s"는 빈칸으로 보지 않음', (v) => {
    expect(extras([`□ 사업기간 : ${v}`]).projectPeriod).toMatchObject({ status: 'verified' });
  });

  it('서식 후보는 같은 문서에 본문 후보가 있을 때만 뒤로 미룬다(다른 문서 본문 값이 이기지 않음)', () => {
    const run = (id: string, lines: string[], priority: number) =>
      runRules([{ doc: docOf(lines), attachmentId: id, sourceFile: id, docKind: 'rfp', priority }], rules).candidates;
    const c = [...run('n', ['표준 용역 계약서(안)', '계약기간 : 2026. 3. 1. ~ 2026. 12. 31.'], 2), ...run('r', ['□ 사업기간 : 2027. 1. 1. ∼ 12. 31.'], 3)];
    expect(decide(c, rules).extras.projectPeriod).toMatchObject({ status: 'needs_review', reason: 'conflict' });
  });

  it('서식 안에만 값이 있으면 그 값을 씀', () => {
    expect(extras(['표준 용역 계약서(안)', '계약기간 : 2026. 3. 1. ~ 2026. 12. 31.']).projectPeriod).toMatchObject({ value: '2026. 3. 1. ~ 2026. 12. 31.', status: 'verified' });
  });
});
