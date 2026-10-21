import type { ISODate } from './common';
import type { NoticeFieldKey, NoticeKind } from './notice';

export type TemplateFieldKey = NoticeFieldKey | 'sourceUrl' | 'attachmentList' | 'attachmentCount' | 'collectedAt' | 'isCorrection' | 'today' | 'credibilityEval' | 'performanceEval' | 'evalMethodText' | `custom.${string}`;
export type TemplateLayout = 'table' | 'list';
export interface TemplateStyle { bold?: boolean; underline?: boolean }
export interface TemplateFieldItem { kind?: 'field'; fieldKey: TemplateFieldKey; label: string; visible: boolean; style?: TemplateStyle }
/** 고정 문구 또는 변수 합성 항목. text는 {변수} 허용 평문. fromFieldKey는 [값 고치기]로 바뀐 항목의 원래 변수(되돌리기용). */
export interface TemplateTextItem { kind: 'text'; id: string; label: string; text: string; visible: boolean; style?: TemplateStyle; fromFieldKey?: TemplateFieldKey }
export type TemplateItem = TemplateFieldItem | TemplateTextItem;
/** title과 inlineValue는 {변수} 허용. inlineValue가 있으면 "N. 제목 : 값" 한 줄로 찍는다.
 * plain이면 번호 없는 문구 블록: title을 여러 줄 본문으로 그대로 찍고 번호를 매기지 않는다(items·inlineValue 무시). */
export interface TemplateSection { id: string; title: string; inlineValue?: string; items: TemplateItem[]; plain?: boolean }
/** subject/greeting/closing은 {변수} 허용 평문. greeting/closing은 줄바꿈 유지. */
export interface Template {
  id: string; name: string; isDefault: boolean;
  subject: string; greeting: string; closing: string;
  layout: TemplateLayout;
  kind?: NoticeKind;   // 없음 = bid
  sections: TemplateSection[];
  updatedAt: ISODate;
}
