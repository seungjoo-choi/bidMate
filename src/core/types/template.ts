import type { ISODate } from './common';
import type { NoticeFieldKey, NoticeKind } from './notice';

export type TemplateFieldKey = NoticeFieldKey | 'sourceUrl' | 'attachmentList' | 'attachmentCount' | 'collectedAt' | 'isCorrection' | 'today' | `custom.${string}`;
export type TemplateLayout = 'table' | 'list';
export interface TemplateStyle { bold?: boolean; underline?: boolean }
export interface TemplateFieldItem { kind?: 'field'; fieldKey: TemplateFieldKey; label: string; visible: boolean; style?: TemplateStyle }
/** 고정 문구 또는 변수 합성 항목. text는 {변수} 허용 평문. */
export interface TemplateTextItem { kind: 'text'; id: string; label: string; text: string; visible: boolean; style?: TemplateStyle }
export type TemplateItem = TemplateFieldItem | TemplateTextItem;
/** title과 inlineValue는 {변수} 허용. inlineValue가 있으면 "N. 제목 : 값" 한 줄로 찍는다. */
export interface TemplateSection { id: string; title: string; inlineValue?: string; items: TemplateItem[]; }
/** subject/greeting/closing은 {변수} 허용 평문. greeting/closing은 줄바꿈 유지. */
export interface Template {
  id: string; name: string; isDefault: boolean;
  subject: string; greeting: string; closing: string;
  layout: TemplateLayout;
  kind?: NoticeKind;   // 없음 = bid
  sections: TemplateSection[];
  updatedAt: ISODate;
}
