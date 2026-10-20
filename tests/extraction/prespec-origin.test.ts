import { describe, expect, it } from 'vitest';
import type { DocModel } from '../../src/core/doc/model';
import type { DocKind } from '../../src/core/extraction/classify';
import { decide, type Candidate } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';
import type { EvidenceRef } from '../../src/core/types/extraction';
import type { AttachmentOrigin } from '../../src/core/types/notice';

const rules = loadRules();
const ev = (id: string, docKind: DocKind, origin?: AttachmentOrigin): EvidenceRef =>
  ({ attachmentId: id, sourceFile: id, location: 'L', evidence: 'e', ruleId: 'cred.table', docKind, ...(origin ? { origin } : {}) });
const cand = (value: unknown, id: string, origin?: AttachmentOrigin, priority = 3): Candidate =>
  ({ target: 'managementScore', value, evidence: ev(id, 'rfp', origin), priority, weight: 1, docKind: 'rfp' });

describe('decide: 사전규격 후보', () => {
  it('bid 30과 prespec 25면 bid 값으로 verified, prespec은 candidates에 남는다', () => {
    const { items } = decide([cand(25, 'p', 'prespec'), cand(30, 'b')], rules);
    expect(items.managementScore).toMatchObject({ value: 30, status: 'verified' });
    expect(items.managementScore.evidence!.attachmentId).toBe('b');
    expect(items.managementScore.candidates).toHaveLength(1);
    expect(items.managementScore.candidates![0]).toMatchObject({ value: 25 });
    expect(items.managementScore.candidates![0]!.evidence.origin).toBe('prespec');
  });
  it('prespec만 있으면 그 값으로 verified, evidence.origin은 prespec', () => {
    const { items } = decide([cand(25, 'p', 'prespec')], rules);
    expect(items.managementScore).toMatchObject({ value: 25, status: 'verified' });
    expect(items.managementScore.evidence!.origin).toBe('prespec');
  });
  it('bid끼리 30/25 충돌이면 prespec 30이 있어도 conflict 유지, prespec은 candidates 뒤', () => {
    const { items } = decide([cand(30, 'b1'), cand(25, 'b2'), cand(30, 'p', 'prespec')], rules);
    expect(items.managementScore).toMatchObject({ value: null, status: 'needs_review', reason: 'conflict' });
    const cs = items.managementScore.candidates!;
    expect(cs).toHaveLength(3);
    expect(cs.map((c) => c.evidence.attachmentId)).toEqual(['b1', 'b2', 'p']);
  });
});

describe('runRules: origin 전달', () => {
  const doc: DocModel = { format: 'txt', blocks: [{ kind: 'p', text: '차등점수제 : 미적용', loc: { block: 0 } }], warnings: [], stats: { chars: 10, tables: 0, ms: 1 } };
  const input = { doc, attachmentId: 'a', sourceFile: 'a.txt', docKind: 'rfp' as DocKind, priority: 3 };
  it('origin이 EvidenceRef에 복사된다', () => {
    const c = runRules([{ ...input, origin: 'prespec' }], rules).candidates.find((x) => x.target === 'differentialScoring')!;
    expect(c.evidence.origin).toBe('prespec');
  });
  it('origin이 없으면 키 자체가 없다', () => {
    const c = runRules([input], rules).candidates.find((x) => x.target === 'differentialScoring')!;
    expect(c.evidence).not.toHaveProperty('origin');
  });
});

describe('valueKey', () => {
  it('끝의 "이내"만 다른 기간 문구는 같은 값', async () => {
    const { valueKey } = await import('../../src/core/extraction/decide');
    expect(valueKey('계약일로부터 180일')).toBe(valueKey('계약일로부터 180일 이내'));
    expect(valueKey('3년 이내')).toBe(valueKey('3년'));
    expect(valueKey('계약일로부터 180일')).not.toBe(valueKey('계약일로부터 90일'));
  });
});
