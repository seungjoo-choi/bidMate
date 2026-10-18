import type { ISODate } from './common';
import type { ComposeSelectorSet } from '../../adapters/naverworks/types';

export interface FieldMapping { key: string; label: string; variable: string; apiPath?: string; htmlSelector?: string; }
export type AutoComposeRecipients =
  | { mode: 'default' }
  | { mode: 'group'; groupId: string }
  | { mode: 'custom'; members: Array<{ recipientId: string; role: 'to' | 'cc' }> };
export type ReviewGate = 'errors_only' | 'conflicts' | 'any_review';
export interface AutoComposeSettings {
  enabled: boolean;
  recipients: AutoComposeRecipients;
  /** 없으면 기본 템플릿(isDefault, 없으면 첫 템플릿) */
  templateId?: string;
  reviewGate: ReviewGate;
}
export type MailProvider = 'naverworks' | 'gmail';
export interface Settings {
  schemaVersion: 1;
  g2b: { apiBaseUrl: string; detailUrlPatterns: string[] };
  sites: {
    /** 트래커봇 메일을 받는 서비스. CS 등록, webmail 발신자 판정, fs/permission-granted 알림 대상 */
    trackerbot: { urlPatterns: string[]; provider: MailProvider };
    naverworks: { host: string /* 기본 'mail.worksmobile.com' */; composePath?: string; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> };
    gmail: { accountIndex: number; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> };
  };
  download: { concurrency: number; maxRetries: number; backoffMs: number; maxFileMB: number };
  extraction: { budgetMs: number; fileTimeoutMs: number; maxParseMB: number };
  autoCompose: AutoComposeSettings;
  /** provider = 메일 작성 서비스 */
  mail: { provider: MailProvider; defaultGroupId?: string; defaultTemplateId?: string };
  customFields: FieldMapping[];
  updatedAt: ISODate;
}
// chrome.storage.local: { secrets: { g2bServiceKey?: string }, settingsCache: Settings, registeredSites }
