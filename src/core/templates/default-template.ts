import type { Template, TemplateFieldKey, TemplateSection, TemplateStyle } from '../types/template';

export const TEMPLATE_DEFAULT_ID = 'tpl_default';

const BU: TemplateStyle = { bold: true, underline: true };
const B: TemplateStyle = { bold: true };

const field = (fieldKey: TemplateFieldKey, label: string, style?: TemplateStyle) => ({
  fieldKey, label, visible: true, ...(style ? { style: { ...style } } : {}),
});
const text = (id: string, label: string, t: string, style?: TemplateStyle) => ({
  kind: 'text' as const, id, label, text: t, visible: true, ...(style ? { style: { ...style } } : {}),
});

const sections = (): TemplateSection[] => [
  { id: 'sec_org', title: '기관명', inlineValue: '{발주기관}', items: [] },
  { id: 'sec_title', title: '사업명', inlineValue: '{공고명}', items: [] },
  {
    id: 'sec_info', title: '공고 정보', items: [
      field('postedAt', '공고 게시일시'),
      text('txt_reg', '입찰참가자격등록', '{참가자격등록마감}까지'),
      field('proposalPeriod', '제안서 제출', BU),
      field('proposalEvalAt', '제안서 평가일자', BU),
      text('txt_budget', '사업금액', '{사업금액}(VAT 포함)', B),
      field('projectPeriod', '사업기간', B),
      field('evalMethod', '평가방법'),
      field('differentialScoring', '차등점수제 적용 여부'),
      text('txt_cred', '대외신인도 평가', '경영상태(신용평가등급) 평가({경영상태}), 대외신인도({대외신인도})'),
      text('txt_perf', '실적점수 평가', '{실적인정기간} 이내 국내외 유사사업 수행실적({실적평가}) - {실적인정금액} 이상인 사업에 한함'),
      field('jointVentureAllowed', '공동수급 여부'),
      field('priceMethod', '예가방법'),
    ],
  },
  { id: 'sec_dept', title: '제안부서', items: [text('txt_dept', '부서명', '넥스트업사업본부'), text('txt_pm', '제안PM', '')] },
  { id: 'sec_links', title: '관련 자료', items: [field('sourceUrl', '나라장터 공고 URL'), field('attachmentList', '첨부파일 목록')] },
];

/** 내장 기본 템플릿(목록형 양식, 명세 template-list-layout). */
export function builtinDefaultTemplate(now: Date): Template {
  return {
    id: TEMPLATE_DEFAULT_ID, name: '기본 템플릿', isDefault: true,
    subject: '[입찰공고 공유] {공고명}',
    greeting: '안녕하세요.\n아래 입찰공고를 공유드립니다.',
    closing: '검토 부탁드립니다.',
    layout: 'list',
    sections: sections(),
    updatedAt: now.toISOString(),
  };
}

export const TEMPLATE_PRESPEC_DEFAULT_ID = 'tpl_prespec_default';

/** 내장 사전규격 템플릿(목록형). 저장된 사전규격 템플릿이 없을 때 목록에 보충된다. */
export function builtinPrespecTemplate(now: Date): Template {
  return {
    id: TEMPLATE_PRESPEC_DEFAULT_ID, name: '사전규격 기본 템플릿', isDefault: true, kind: 'prespec',
    subject: '[사전규격 공유] {사전규격명}',
    greeting: '안녕하세요.\n아래 사전규격을 공유드립니다.',
    closing: '검토 부탁드립니다.',
    layout: 'list',
    sections: [
      { id: 'sec_org', title: '기관명', inlineValue: '{발주기관}', items: [] },
      { id: 'sec_title', title: '사업명', inlineValue: '{사전규격명}', items: [] },
      {
        id: 'sec_info', title: '사전규격 정보', items: [
          field('specRegNo', '사전규격 등록번호'),
          field('bizDivision', '업무구분'),
          field('registeredAt', '공개일시'),
          field('opinionCloseAt', '의견등록마감일시', BU),
          text('txt_budget', '배정예산', '{배정예산}'),
          text('txt_officer', '담당자', '{담당자} ({담당자연락처})'),
        ],
      },
      { id: 'sec_dept', title: '제안부서', items: [text('txt_dept', '부서명', '넥스트업사업본부'), text('txt_pm', '제안PM', '')] },
      { id: 'sec_links', title: '관련 자료', items: [field('sourceUrl', '나라장터 사전규격 URL'), field('attachmentList', '규격서 목록')] },
    ],
    updatedAt: now.toISOString(),
  };
}
