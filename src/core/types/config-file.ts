import type { ISODate } from './common';
import type { Group, Recipient } from './recipient';
import type { Template } from './template';

export interface ConfigList<T> { schemaVersion: 1; updatedAt: ISODate; items: T[] }

export interface ConfigWarnings { warnings: string[] }
export interface RecipientsSnapshot extends ConfigWarnings { recipients: Recipient[]; groups: Group[] }

/** 네이버웍스 연락처 불러오기에서 선택된 변경 계획 */
export interface RecipientImportPlan {
  add: Array<{ name: string; email: string; dept?: string }>;
  update: Array<{ id: string; name: string; dept?: string }>;   // dept 생략 = 부서 제거
  disable: string[];                                             // recipient id
}
export interface RecipientImportSummary {
  added: number; updated: number; disabled: number;
  skipped: Array<{ key: string; reason: string }>;               // key = email 또는 id
}
export type RecipientImportResult = RecipientsSnapshot & { summary: RecipientImportSummary };
export interface TemplatesSnapshot extends ConfigWarnings { templates: Template[] }
export type RecipientInput = Omit<Recipient, 'id' | 'updatedAt'> & { id?: string; groupIds?: string[] };
export type GroupInput = Omit<Group, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };
export type TemplateInput = Omit<Template, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };
