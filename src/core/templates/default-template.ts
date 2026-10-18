import type { Template, TemplateFieldKey, TemplateSection } from '../types/template';

export const TEMPLATE_DEFAULT_ID = 'tpl_default';

const sec = (id: string, title: string, items: Array<[TemplateFieldKey, string]>): TemplateSection => ({
  id, title, items: items.map(([fieldKey, label]) => ({ fieldKey, label, visible: true })),
});

/** 내장 기본 템플릿(요구사항 8절 양식). */
export function builtinDefaultTemplate(now: Date): Template {
  return {
    id: TEMPLATE_DEFAULT_ID, name: '기본 템플릿', isDefault: true,
    subject: '[입찰공고 공유] {공고명}',
    greeting: '안녕하세요.\n아래 입찰공고를 공유드립니다.',
    closing: '검토 부탁드립니다.',
    sections: [
      sec('sec_overview', '공고 개요', [
        ['orderingOrg', '기관명'], ['title', '사업명'], ['postedAt', '공고 게시일'], ['budgetAmount', '사업금액'], ['projectPeriod', '사업기간'],
      ]),
      sec('sec_schedule', '입찰 일정', [
        ['registrationDeadline', '참가자격 등록마감'], ['proposalPeriod', '제안서 제출 기간'], ['proposalEvalAt', '제안서 평가일시'],
      ]),
      sec('sec_contract', '계약 및 평가', [
        ['contractMethod', '계약방법'], ['evalMethod', '평가방법'], ['differentialScoring', '차등점수제'],
        ['credibilityScore', '대외신인도 평가'], ['performanceScore', '수행실적 평가'], ['performanceCondition', '실적 인정조건'],
        ['jointVentureAllowed', '공동수급'], ['priceMethod', '예가방법'],
      ]),
      sec('sec_links', '관련 자료', [
        ['sourceUrl', '나라장터 공고 URL'], ['attachmentList', '첨부파일 목록'],
      ]),
    ],
    updatedAt: now.toISOString(),
  };
}
