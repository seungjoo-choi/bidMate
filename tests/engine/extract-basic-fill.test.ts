import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { ExtractedItem } from '../../src/core/types/extraction';
import { basicFieldsOf, fillBasicFromDocs } from '../../src/engine/extraction/extract-step';

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
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: '계약일로부터 12개월', status: 'verified', source: { kind: 'document' } });
  });
  it('13. html verified 값은 그대로, 후보도 없다', () => {
    const n = mk();
    n.basic.projectPeriod = { value: '2026.1.1~2026.12.31', status: 'verified', source: { kind: 'html', ref: 'x', fetchedAt: NOW } };
    const before = structuredClone(n.basic.projectPeriod);
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toEqual(before);
    expect(n.basic.projectPeriod.candidates).toBeUndefined();
  });
  it('14. user_edited는 그대로', () => {
    const n = mk();
    n.basic.projectPeriod = { value: '직접 입력', status: 'user_edited', source: { kind: 'user', ref: 'u', fetchedAt: NOW } };
    const before = structuredClone(n.basic.projectPeriod);
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toEqual(before);
  });
  it('15. 이전 document 값이 이번 추출에서 사라지면 확인 필요', () => {
    const n = mk();
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: notFound }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: '계약일로부터 12개월', status: 'needs_review', note: '최근 추출에서 값이 확인되지 않음' });
  });
  it('16. evaluation 키는 전후 동일', () => {
    const n = mk();
    const before = structuredClone(n.evaluation);
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    expect(n.evaluation).toEqual(before);
  });
  it('17. 문서 간 충돌 값을 저장한 뒤 재추출하면 새 문서 값으로 갱신된다', () => {
    const ev = (id: string, v: string) => ({ attachmentId: id, sourceFile: `${id}.hwp`, location: '블록1', evidence: v, ruleId: 'basic.projectPeriod', docKind: 'rfp' as const });
    const conflict = {
      value: 'A안', status: 'needs_review', reason: 'conflict', raw: 'A안', evidence: ev('a1', 'A안'),
      candidates: [{ value: 'A안', raw: 'A안', evidence: ev('a1', 'A안') }, { value: 'B안', raw: 'B안', evidence: ev('a2', 'B안') }],
    } as ExtractedItem<unknown>;
    const n = mk();
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: conflict }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: 'A안', status: 'needs_review', source: { kind: 'document' } });
    fillBasicFromDocs(n, basicFieldsOf({ projectPeriod: found }, NOW));
    expect(n.basic.projectPeriod).toMatchObject({ value: found.value, status: 'verified' });
  });
});

