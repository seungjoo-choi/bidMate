import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { ExtractedItem } from '../../src/core/types/extraction';
import { docOnlyFieldsOf, fillDocOnlyFields } from '../../src/engine/extraction/extract-step';

const NOW = '2026-10-20T00:00:00Z';
const mk = () => emptyNotice('N-1', { noticeNo: 'R26BK1', round: '000', kind: 'bid', origin: 'g2b' }, 'folder/x', NOW);
const found: ExtractedItem<unknown> = {
  value: '계약일로부터 12개월', raw: '사업기간: 계약일로부터 12개월', status: 'verified',
  evidence: { attachmentId: 'a', sourceFile: 'a.hwp', location: '블록0', evidence: '사업기간: 계약일로부터 12개월', ruleId: 'basic.projectPeriod', docKind: 'notice' },
};
const notFound: ExtractedItem<unknown> = { value: null, status: 'needs_review', reason: 'not_found' };

describe('basic 사업기간 문서 보충', () => {
  it('12. 값이 없으면 문서 값으로 채운다', () => {
    const n = mk();
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: '계약일로부터 12개월', status: 'verified', source: { kind: 'document' } });
  });
  it('13. html verified 값은 그대로, 후보도 없다', () => {
    const n = mk();
    n.basic.projectPeriod = { value: '2026.1.1~2026.12.31', status: 'verified', source: { kind: 'html', ref: 'x', fetchedAt: NOW } };
    const before = structuredClone(n.basic.projectPeriod);
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toEqual(before);
    expect(n.basic.projectPeriod.candidates).toBeUndefined();
  });
  it('14. user_edited는 그대로', () => {
    const n = mk();
    n.basic.projectPeriod = { value: '직접 입력', status: 'user_edited', source: { kind: 'user', ref: 'u', fetchedAt: NOW } };
    const before = structuredClone(n.basic.projectPeriod);
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toEqual(before);
  });
  it('15. 이전 document 값이 이번 추출에서 사라지면 확인 필요', () => {
    const n = mk();
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: notFound }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: '계약일로부터 12개월', status: 'needs_review', note: '최근 추출에서 값이 확인되지 않음' });
  });
  it('16. evaluation 키는 전후 동일', () => {
    const n = mk();
    const before = structuredClone(n.evaluation);
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    expect(n.evaluation).toEqual(before);
  });
  it('17. 문서 간 충돌 값을 저장한 뒤 재추출하면 새 문서 값으로 갱신된다', () => {
    const ev = (id: string, v: string) => ({ attachmentId: id, sourceFile: `${id}.hwp`, location: '블록1', evidence: v, ruleId: 'basic.projectPeriod', docKind: 'rfp' as const });
    const conflict = {
      value: 'A안', status: 'needs_review', reason: 'conflict', raw: 'A안', evidence: ev('a1', 'A안'),
      candidates: [{ value: 'A안', raw: 'A안', evidence: ev('a1', 'A안') }, { value: 'B안', raw: 'B안', evidence: ev('a2', 'B안') }],
    } as ExtractedItem<unknown>;
    const n = mk();
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: conflict }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: 'A안', status: 'needs_review', source: { kind: 'document' } });
    fillDocOnlyFields(n, docOnlyFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: found.value, status: 'verified' });
  });
});

describe('제안서 제출기간·평가일시·정량평가 문서 보충', () => {
  const item = (value: string, ruleId: string): ExtractedItem<unknown> => ({
    value, raw: value, status: 'verified',
    evidence: { attachmentId: 'a', sourceFile: 'a.hwp', location: '블록0', evidence: value, ruleId, docKind: 'notice' },
  });
  const extras = {
    proposalPeriod: item('2024. 4. 11.(목) 10:00 ~ 2024. 4. 16.(화) 10:00', 'sched.proposalPeriodDoc'),
    proposalEvalAt: item('2024/10/08 09:30', 'sched.proposalEvalDoc'),
    quantEvalDoc: item('정량평가 : 조달청(경영상태), 수요기관(수행실적)', 'eval.quantDoc'),
  };
  const html = (v: string) => ({ value: v, status: 'verified' as const, source: { kind: 'html' as const, ref: 'x', fetchedAt: NOW } });

  it('화면값이 없으면 문서값으로 채우고 평가일시는 ISO(+09:00)로 변환한다', () => {
    const n = mk();
    fillDocOnlyFields(n, docOnlyFieldsOf(extras, NOW));
    expect(n.schedule.proposalPeriod).toMatchObject({ value: '2024. 4. 11.(목) 10:00 ~ 2024. 4. 16.(화) 10:00', source: { kind: 'document' } });
    expect(n.schedule.proposalEvalAt).toMatchObject({ value: '2024-10-08T09:30:00+09:00', source: { kind: 'document' } });
    expect(n.evaluation.quantEvalDoc).toMatchObject({ value: '정량평가 : 조달청(경영상태), 수요기관(수행실적)', source: { kind: 'document' } });
  });
  it('화면(html) 값이 있으면 그대로 둔다', () => {
    const n = mk();
    n.schedule.proposalPeriod = html('2024/04/11 10:00 ~ 2024/04/16 10:00');
    n.schedule.proposalEvalAt = html('2024-10-09T10:00:00+09:00');
    const before = structuredClone([n.schedule.proposalPeriod, n.schedule.proposalEvalAt]);
    fillDocOnlyFields(n, docOnlyFieldsOf(extras, NOW));
    expect([n.schedule.proposalPeriod, n.schedule.proposalEvalAt]).toEqual(before);
  });
  it('user_edited는 그대로 둔다', () => {
    const n = mk();
    n.schedule.proposalPeriod = { value: '직접 입력', status: 'user_edited', source: { kind: 'user', ref: 'u', fetchedAt: NOW } };
    fillDocOnlyFields(n, docOnlyFieldsOf(extras, NOW));
    expect(n.schedule.proposalPeriod.value).toBe('직접 입력');
  });
  it('평가일시 ISO 변환에 실패하면(시각 없음·범위 밖) 값을 설정하지 않는다', () => {
    for (const bad of ['2024. 3. 7.(목)', '2024/13/08 09:30', '2024/10/08 25:30', '2024.02.30. 10:00', '추후 공지']) {
      const n = mk();
      fillDocOnlyFields(n, docOnlyFieldsOf({ proposalEvalAt: item(bad, 'sched.proposalEvalDoc') }, NOW));
      expect(n.schedule.proposalEvalAt.value).toBeNull();
    }
  });
});
