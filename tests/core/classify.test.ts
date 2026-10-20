import { describe, expect, it } from 'vitest';
import { classifyName, planFiles } from '../../src/core/extraction/classify';
import type { Attachment } from '../../src/core/types/notice';

const att = (name: string, i = 0): Attachment => ({
  id: `a${i}`, index: i, originalName: name, savedName: name, url: 'u', expectedSize: null, savedSize: 1, status: 'saved', attempts: 1,
});

describe('classifyName', () => {
  it.each([
    ['1. 입찰공고문.hwp', 'notice', 2],
    ['1. 입찰공고문.pdf', 'notice', 2],
    ['2. 제안요청서.hwp', 'rfp', 3],
    ['3. 투찰내역서(양식).xlsm', 'form', 0],
    ['4. 사업 참고 자료.zip', 'reference', 0],
    ['5. (참고) 사전공고 질의답변.hwp', 'qna', 4],
    ['질의회신에 따른 정정공고문.hwp', 'notice', 2],
    ['평가기준(질의답변 반영).hwp', 'qna', 4],
    ['제안요청서 질의 답변.hwp', 'qna', 4],
    ['입찰공고 질의답변.hwp', 'qna', 4],
    ['정정공고문(질의회신 반영).hwp', 'notice', 2],
    ['입찰 관련 규정.hwp', 'reference', 0],
    ['6. KOICA 입찰 관련 규정, 표준계약서 등(260725).zip', 'reference', 0],
    ['제안서 평가기준표.hwp', 'eval_criteria', 1],
    ['붙임1.hwp', 'other', 5],
    ['(계약예규) 용역계약일반조건(재정경제부계약예규)(제149호)(20260430).hwpx', 'reference', 0],
    ['제안요청서(계약일반조건 포함).hwp', 'rfp', 3],
    ['입찰공고문(붙임 규정 포함).pdf', 'notice', 2],
    ['참고자료(제안요청서 포함).zip', 'reference', 0],
  ])('%s', (name, kind, priority) => {
    expect(classifyName(name)).toEqual({ kind, priority });
  });
});

describe('classifyName 공고명 제거', () => {
  const title = '내부규정관리시스템 기능 개선 용역';
  it('공고명 속 낱말(규정)로 오판하지 않는다', () => {
    expect(classifyName('(붙임2) 내부규정관리시스템 기능 개선 용역 입찰공고문.hwp', title)).toEqual({ kind: 'notice', priority: 2 });
    expect(classifyName('(붙임3) 내부규정관리시스템 기능 개선 용역 제안요청서.hwp', title)).toEqual({ kind: 'rfp', priority: 3 });
  });
  it('공고명이 없거나 파일명에 없으면 종전대로 판정', () => {
    expect(classifyName('(붙임2) 내부규정관리시스템 기능 개선 용역 입찰공고문.hwp')).toEqual({ kind: 'reference', priority: 0 });
    expect(classifyName('입찰 관련 규정.hwp', title)).toEqual({ kind: 'reference', priority: 0 });
  });
  it('공고명을 지운 뒤 판정이 안 되면 원래 이름으로 판정한다', () => {
    expect(classifyName('축산 성과평가 기준표.hwp', '축산 성과평가').kind).toBe('eval_criteria');
  });
  it('공백 차이는 무시한다', () => {
    expect(classifyName('내부규정관리시스템기능 개선용역_입찰공고문.hwp', title).kind).toBe('notice');
  });
});

describe('planFiles', () => {
  it('image.png는 unsupported_ext', () => {
    const p = planFiles([att('image.png')])[0]!;
    expect(p.action).toBe('skip');
    expect(p.skipReason).toBe('unsupported_ext');
  });
  it('hwp와 pdf 쌍둥이면 pdf는 duplicate', () => {
    const plan = planFiles([att('1. 입찰공고문.hwp', 0), att('1. 입찰공고문.pdf', 1)]);
    expect(plan[0]!.action).toBe('parse');
    expect(plan[1]!).toMatchObject({ action: 'skip', skipReason: 'duplicate' });
  });
  it('hwp가 저장 실패면 pdf 쌍둥이를 파싱', () => {
    const hwp = { ...att('1. 입찰공고문.hwp', 0), status: 'failed' as const, savedName: null };
    const plan = planFiles([hwp, att('1. 입찰공고문.pdf', 1)]);
    expect(plan[0]!).toMatchObject({ action: 'skip', skipReason: 'not_saved' });
    expect(plan[1]!.action).toBe('parse');
  });
  it('pdf만 있으면 parse', () => {
    expect(planFiles([att('1. 입찰공고문.pdf')])[0]!.action).toBe('parse');
  });
  it('form/reference는 excluded', () => {
    expect(planFiles([att('4. 사업 참고 자료.zip')])[0]!).toMatchObject({ action: 'skip', skipReason: 'excluded' });
  });
  it('duplicateOf가 있으면 duplicate(not_saved보다 앞)', () => {
    const a = { ...att('제안요청서.hwp'), status: 'skipped' as const, savedName: 'x.hwp', duplicateOf: 'a0', origin: 'prespec' as const };
    expect(planFiles([a])[0]!).toMatchObject({ action: 'skip', skipReason: 'duplicate' });
  });
  it('bid pdf와 prespec hwpx가 같은 이름이면 둘 다 parse', () => {
    const bid = att('제안요청서.pdf', 0);
    const pre = { ...att('제안요청서.hwpx', 1), origin: 'prespec' as const };
    expect(planFiles([bid, pre]).map((p) => p.action)).toEqual(['parse', 'parse']);
  });
  it('같은 origin의 hwp/pdf는 기존대로 pdf가 duplicate', () => {
    const hwp = { ...att('제안요청서.hwp', 0), origin: 'prespec' as const };
    const pdf = { ...att('제안요청서.pdf', 1), origin: 'prespec' as const };
    const plan = planFiles([hwp, pdf]);
    expect(plan[0]!.action).toBe('parse');
    expect(plan[1]!).toMatchObject({ action: 'skip', skipReason: 'duplicate' });
  });
});
