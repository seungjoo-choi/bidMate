import { describe, expect, it } from 'vitest';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import type { DocKind } from '../../src/core/extraction/classify';
import { decide } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';

const rules = loadRules();
const P = (text: string, i: number): DocBlock => ({ kind: 'p', text, loc: { block: i, line: i + 1 } });
const docOf = (blocks: DocBlock[]): DocModel => ({ format: 'txt', warnings: [], stats: { chars: 10, tables: 0, ms: 1 }, blocks });
type Src = [DocKind, string[]];
const run = (srcs: Src[], ctx: { awardMethod?: string } = {}) => {
  const inputs = srcs.map(([docKind, lines], i) => ({ doc: docOf(lines.map(P)), attachmentId: `d${i}`, sourceFile: `d${i}.txt`, docKind, priority: docKind === 'notice' ? 2 : 3 }));
  return decide(runRules(inputs, rules).candidates, rules, ctx).items;
};
const NF = { status: 'needs_review', reason: 'not_found' };
const HYDRO = '「수소생산시설 50N㎥/h 이상의 개질형 수소생산 설비(수소추출기)의 설계, 제작 시공 또는 유지보수 실적이 있는 업체」';
const DEF = '- 유사용역 : 어업피해영향 조사 용역';
const str = (v: unknown) => String(v);

describe('참가자격 실적 조건(performanceCondition)', () => {
  it('1. 유사용역 정의 줄', () => {
    expect(str(run([['rfp', [DEF]]]).performanceCondition.value)).toContain('어업피해영향 조사 용역');
  });
  it('2. 동등 이상 사업범위 줄', () => {
    expect(str(run([['rfp', ['- 동등 이상 사업범위 : 기록물 전산화(DB구축) 용역 사업']]]).performanceCondition.value)).toContain('기록물 전산화');
  });
  it('3. 동일종류용역 및 평가비율 줄', () => {
    expect(str(run([['notice', ['- 동일종류용역 및 평가비율 : 수질검사 용역(100%)']]]).performanceCondition.value)).toContain('수질검사 용역');
  });
  it('4. 실적이 있는 업체 한 줄로 채움', () => {
    const it = run([['notice', [HYDRO]]]).performanceCondition;
    expect(it.status).toBe('verified');
    expect(str(it.value)).toContain('수소생산 설비');
  });
  it('5. 유사용역 정의가 실적이 있는 업체 줄보다 우선', () => {
    const v = str(run([['rfp', [DEF]], ['notice', [HYDRO]]]).performanceCondition.value);
    expect(v).toContain('어업피해영향');
    expect(v).not.toContain('수소생산');
  });
  it('6. 신용과 실적이 있는 자는 제외', () => {
    expect(run([['notice', ['1) 당해 용역을 수행할 수 있는 신용과 실적이 있는 자']]]).performanceCondition).toMatchObject(NF);
  });
  it('7. 있는 경우 안내 문장은 제외', () => {
    expect(run([['rfp', ['2) ASME, KEPIC, ISO 등 보유인증서 및 실적이 있는 경우 상세하게 기술']]]).performanceCondition).toMatchObject(NF);
  });
  it('8. 하수급인 줄은 제외', () => {
    expect(run([['notice', ['하수급인의 시공실적이 있는 업체는 제외합니다']]]).performanceCondition).toMatchObject(NF);
  });
  it('9. other 문서는 대상이 아님', () => {
    expect(run([['other', [HYDRO]]]).performanceCondition).toMatchObject(NF);
  });
  it('10. 소액수의견적이어도 참가자격 실적 조건은 유지, 실적 하위 일부는 not_found', () => {
    const items = run([['notice', ['용역 소액수의 견적제출 안내공고', HYDRO]]], { awardMethod: '소액수의견적-소액수의견적(2인 이상 견적 제출)' });
    expect(items.performanceCondition.status).toBe('verified');
    expect(str(items.performanceCondition.value)).toContain('수소생산 설비');
    expect(items.performancePeriod).toMatchObject(NF);
    expect(items.performanceMinAmount).toMatchObject(NF);
    expect(items.managementScore).toMatchObject({ status: 'verified', reason: 'not_applicable' });
  });
});
