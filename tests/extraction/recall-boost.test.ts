import { describe, expect, it } from 'vitest';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import { decide } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules, type RuleDocInput } from '../../src/core/extraction/run-rules';
import { docOnlyFieldsOf } from '../../src/engine/extraction/extract-step';

// 채움률 보강: 표 라벨/값 셀 분리 사례(R25BK00670449, R25BK00653097, R26BK01439250)를 실제 표 블록으로 확인한다.
const cell = (r: number, c: number, text: string) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0 } });
const table = (rows: string[][]): DocBlock => ({
  kind: 'table', index: 0, rows: rows.length, cols: rows[0]!.length, loc: { block: 0 },
  cells: rows.flatMap((row, r) => row.map((t, c) => cell(r, c, t))),
});
const P = (text: string): DocBlock => ({ kind: 'p', text, loc: { block: 0 } });
const doc = (blocks: DocBlock[]): DocModel => ({ format: 'txt', blocks, warnings: [], stats: { chars: 0, tables: 0, ms: 0 } });
const extras = (d: DocModel) => {
  const rules = loadRules();
  const input: RuleDocInput = { doc: d, attachmentId: 'x', sourceFile: 'x.txt', docKind: 'notice', priority: 2 };
  return decide(runRules([input], rules).candidates, rules).extras;
};

/** 문서 보충 필드로 바꾼 사업기간(같은 줄 규칙 우선, 없으면 보조 규칙). */
const period = (d: DocModel) => docOnlyFieldsOf(extras(d), '2026-10-20T00:00:00Z').projectPeriod;

describe('사업기간 표 옆 칸', () => {
  it('용역기간 | 계약체결일로부터 180일까지 (R25BK00670449)', () => {
    const e = extras(doc([table([['용 역 명', ' 자율형 조직 성과 분석 및 발전방안 연구'], ['용역기간', ' 계약체결일로부터 180일까지'], ['용역내용', ' 제안요청서 참조']])]));
    expect(period(doc([table([['용 역 명', ' 자율형 조직 성과 분석 및 발전방안 연구'], ['용역기간', ' 계약체결일로부터 180일까지'], ['용역내용', ' 제안요청서 참조']])]))).toMatchObject({ value: '계약체결일로부터 180일까지', status: 'verified' });
    expect(e.projectPeriodCell).toMatchObject({ value: '계약체결일로부터 180일까지' });
  });
  it('사업기간 | 계약 체결일로부터 2025년 11월 30일까지 (R25BK00653097)', () => {
    const e = extras(doc([table([['사업명', '축산계열화사업자 등급평가 용역'], ['사업기간', '계약 체결일로부터 2025년 11월 30일까지']])]));
    expect(e.projectPeriodCell).toMatchObject({ value: '계약 체결일로부터 2025년 11월 30일까지' });
  });
  it('계약기간: | 계약체결일로부터 2027.12.31.까지 (R26BK01439250)', () => {
    const e = extras(doc([table([['계약기간:', '계약체결일로부터 2027.12.31.까지']])]));
    expect(e.projectPeriodCell).toMatchObject({ value: '계약체결일로부터 2027.12.31.까지' });
  });
  it('값 셀에 기간 신호가 없으면 후보가 아니다', () => {
    expect(period(doc([table([['용역기간', '제안요청서 참조'], ['배정예산', '금50,000,000원(부가세 포함)']])]))).toBeUndefined();
  });
  it('값 없는 문장은 후보가 아니다 (오탐 금지)', () => {
    const s = '이 입찰의 사업금액은 전체 사업기간을 기준으로 산출되었으며, 가격입찰은 반드시 전체 사업기간에 해당하는 금액으로 입찰하여 주시기 바랍니다.';
    expect(period(doc([P(s)]))).toBeUndefined();
    expect(period(doc([table([[s]])]))).toBeUndefined();
  });
  it('(총 용역기간 : …) 줄 중간 표기 (R25BK00553902)', () => {
    const e = extras(doc([P('- 총 사업예산 : 38,685,594,000원 (총 용역기간 : 2025. 1. 1. ~ 2026. 12. 31.)')]));
    expect(period(doc([P('- 총 사업예산 : 38,685,594,000원 (총 용역기간 : 2025. 1. 1. ~ 2026. 12. 31.)')]))).toMatchObject({ value: '2025. 1. 1. ~ 2026. 12. 31.' });
    expect(e.projectPeriodParen).toMatchObject({ value: '2025. 1. 1. ~ 2026. 12. 31.' });
  });
  it('같은 줄 값이 있으면 표 옆 칸 값과 충돌하지 않고 verified를 유지한다', () => {
    const d = doc([P('나. 용역기간 : 계약체결일로부터 2028.02.28.까지'), table([['사업기간', '15개월 (계약체결일로부터 ~ 2028.02.28.)']])]);
    expect(extras(d).projectPeriod).toMatchObject({ value: '계약체결일로부터 2028.02.28.까지', status: 'verified' });
    expect(period(d)).toMatchObject({ value: '계약체결일로부터 2028.02.28.까지', status: 'verified' });
  });
});

describe('문서 보충 extras 종단', () => {
  it('제안서 제출기간·평가일시·정량평가 문장', () => {
    const e = extras(doc([
      P('4-1. 입찰서 제출기간 : 2024. 4. 11.(목) 10:00 ~ 2024. 4. 16.(화) 10:00'),
      P('7-3. 제안서 평가 일시 : 2024/10/08 09:30 ~ (상황에 따라 변경 가능)'),
      P('- 정량평가 : 조달청(경영상태), 수요기관(수행실적)'),
    ]));
    expect(e.proposalPeriod).toMatchObject({ value: '2024. 4. 11.(목) 10:00 ~ 2024. 4. 16.(화) 10:00', status: 'verified' });
    expect(e.proposalEvalAt).toMatchObject({ value: '2024/10/08 09:30' });
    expect(e.quantEvalDoc).toMatchObject({ value: '정량평가 : 조달청(경영상태), 수요기관(수행실적)' });
  });
});
