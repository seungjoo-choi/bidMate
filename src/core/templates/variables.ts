import type { NoticeKind } from '../types/notice';
import type { TemplateFieldKey } from '../types/template';

export type { TemplateFieldKey };
export type VariableKind = 'text' | 'amount' | 'amount_short' | 'datetime' | 'date' | 'bool_joint' | 'bool_apply' | 'score' | 'period' | 'url' | 'list' | 'number';
export interface VariableDef { name: string; fieldKey: TemplateFieldKey; label: string; group: '기본' | '일정' | '평가' | '사전규격' | '기타'; kind: VariableKind; kinds: NoticeKind[]; }

const BID: NoticeKind[] = ['bid'];
const BOTH: NoticeKind[] = ['bid', 'prespec'];
const PRESPEC: NoticeKind[] = ['prespec'];
const v = (name: string, fieldKey: TemplateFieldKey, group: VariableDef['group'], kind: VariableKind, kinds: NoticeKind[] = BID): VariableDef =>
  ({ name, fieldKey, label: name, group, kind, kinds });

export const VARIABLES: VariableDef[] = [
  v('공고번호', 'noticeNo', '기본', 'text'),
  v('공고차수', 'round', '기본', 'text'),
  v('공고명', 'title', '기본', 'text'),
  v('게시일시', 'postedAt', '기본', 'datetime'),
  v('공고구분', 'noticeType', '기본', 'text'),
  v('발주기관', 'orderingOrg', '기본', 'text', BOTH),
  v('수요기관', 'demandOrg', '기본', 'text', BOTH),
  v('사업금액', 'budgetAmount', '기본', 'amount'),
  v('추정가격', 'estimatedPrice', '기본', 'amount'),
  v('사업기간', 'projectPeriod', '기본', 'text'),
  v('계약방법', 'contractMethod', '기본', 'text'),
  v('낙찰자결정방법', 'awardMethod', '기본', 'text'),
  v('예가방법', 'priceMethod', '기본', 'text'),
  v('공동수급', 'jointVentureAllowed', '기본', 'bool_joint'),
  v('참가자격', 'eligibility', '기본', 'text'),
  v('참가자격등록마감', 'registrationDeadline', '일정', 'datetime'),
  v('입찰시작일', 'bidStartAt', '일정', 'datetime'),
  v('입찰마감일', 'bidCloseAt', '일정', 'datetime'),
  v('제안서제출기간', 'proposalPeriod', '일정', 'text'),
  v('제안서평가일', 'proposalEvalAt', '일정', 'datetime'),
  v('개찰일시', 'openingAt', '일정', 'datetime'),
  v('평가방법', 'evalMethodText', '평가', 'text'),
  v('공고정보평가방법', 'evalMethod', '평가', 'text'),
  v('문서평가방식', 'evalMethodDoc', '평가', 'text'),
  v('대외신인도평가', 'credibilityEval', '평가', 'text'),
  v('실적점수평가', 'performanceEval', '평가', 'text'),
  v('차등점수제', 'differentialScoring', '평가', 'bool_apply'),
  v('대외신인도', 'credibilityScore', '평가', 'score'),
  v('경영상태', 'managementScore', '평가', 'score'),
  v('실적평가', 'performanceScore', '평가', 'score'),
  v('실적인정기간', 'performancePeriod', '평가', 'period'),
  v('실적인정금액', 'performanceMinAmount', '평가', 'amount_short'),
  v('실적인정조건', 'performanceCondition', '평가', 'text'),
  v('공고URL', 'sourceUrl', '기타', 'url', BOTH),
  v('첨부파일목록', 'attachmentList', '기타', 'list', BOTH),
  v('첨부파일수', 'attachmentCount', '기타', 'number', BOTH),
  v('수집일시', 'collectedAt', '기타', 'datetime', BOTH),
  v('정정공고', 'isCorrection', '기타', 'text'),
  v('오늘', 'today', '기타', 'text', BOTH),
  // 사전규격 전용
  v('사전규격등록번호', 'specRegNo', '사전규격', 'text', PRESPEC),
  v('사전규격명', 'specName', '사전규격', 'text', PRESPEC),
  v('업무구분', 'bizDivision', '사전규격', 'text', PRESPEC),
  v('배정예산', 'assignedBudget', '사전규격', 'amount', PRESPEC),
  v('공개일시', 'registeredAt', '사전규격', 'datetime', PRESPEC),
  v('의견등록마감일시', 'opinionCloseAt', '사전규격', 'datetime', PRESPEC),
  v('담당자', 'officerName', '사전규격', 'text', PRESPEC),
  v('담당자연락처', 'officerTel', '사전규격', 'text', PRESPEC),
  v('연계입찰공고번호', 'relatedBidNo', '사전규격', 'text', PRESPEC),
];

export const VARIABLE_BY_NAME = new Map<string, VariableDef>(VARIABLES.map((d) => [d.name, d]));
export const VARIABLE_BY_KEY = new Map<TemplateFieldKey, VariableDef>(VARIABLES.map((d) => [d.fieldKey, d]));

/** 해당 종류에서 쓸 수 있는 변수. */
export const variablesFor = (kind: NoticeKind): VariableDef[] => VARIABLES.filter((d) => d.kinds.includes(kind));

/** 레지스트리에 있는 키이거나 `custom.<key>` 접두사면 true. */
export function isTemplateFieldKey(k: unknown): k is TemplateFieldKey {
  if (typeof k !== 'string') return false;
  if (VARIABLE_BY_KEY.has(k as TemplateFieldKey)) return true;
  return k.startsWith('custom.') && k.length > 'custom.'.length;
}
