import type { ISODate } from './common';
import type { NoticeFieldKey } from './notice';

export type TemplateFieldKey = NoticeFieldKey | 'sourceUrl' | 'attachmentList' | 'attachmentCount' | 'collectedAt' | 'isCorrection' | `custom.${string}`;
export interface TemplateFieldItem { fieldKey: TemplateFieldKey; label: string; visible: boolean; }
export interface TemplateSection { id: string; title: string; items: TemplateFieldItem[]; }
/** subject/greeting/closing은 {변수} 허용 평문. greeting/closing은 줄바꿈 유지. */
export interface Template {
  id: string; name: string; isDefault: boolean;
  subject: string; greeting: string; closing: string;
  sections: TemplateSection[];
  updatedAt: ISODate;
}
