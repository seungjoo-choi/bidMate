import type { ISODate } from './common';
import type { AiMode, AiProvider } from './ai';
import type { ComposeSelectorSet } from '../../adapters/naverworks/types';

export interface FieldMapping { key: string; label: string; variable: string; apiPath?: string; htmlSelector?: string; }
export type AutoComposeRecipients =
  | { mode: 'default' }
  | { mode: 'group'; groupId: string }
  | { mode: 'custom'; members: Array<{ recipientId: string; role: 'to' | 'cc' }> };
export type ReviewGate = 'errors_only' | 'conflicts' | 'any_review';
/** 수집 완료 후 동작. ask=수집이 끝난 뒤 진행 팝업에서 고르기 */
export type AfterCollect = 'dashboard' | 'compose' | 'ask';
export interface AutoComposeSettings {
  enabled: boolean;
  /** 수집 완료 후 동작: dashboard=편집 화면 열기, compose=바로 작성 */
  afterCollect: AfterCollect;
  recipients: AutoComposeRecipients;
  /** 없으면 기본 템플릿(isDefault, 없으면 첫 템플릿) */
  templateId?: string;
  /** 없으면 사전규격 기본 템플릿 */
  prespecTemplateId?: string;
  reviewGate: ReviewGate;
}
export type MailProvider = 'naverworks' | 'gmail';
export interface Settings {
  schemaVersion: 1;
  g2b: { apiBaseUrl: string; detailUrlPatterns: string[] };
  sites: {
    /** 트래커봇 메일을 받는 서비스. CS 등록, webmail 발신자 판정, fs/permission-granted 알림 대상 */
    trackerbot: { urlPatterns: string[]; provider: MailProvider };
    naverworks: { host: string /* 기본 'mail.worksmobile.com' */; composePath?: string; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet>; /** 사내 연락처 domainId(불러오기에서 자동 감지) */ contactDomainId?: string };
    gmail: { accountIndex: number; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> };
  };
  download: { concurrency: number; maxRetries: number; backoffMs: number; maxFileMB: number };
  extraction: { budgetMs: number; fileTimeoutMs: number; maxParseMB: number };
  autoCompose: AutoComposeSettings;
  /** provider = 메일 작성 서비스 */
  mail: { provider: MailProvider; defaultGroupId?: string; defaultTemplateId?: string };
  customFields: FieldMapping[];
  /** 우리 회사. 평가 분석의 우리 회사 기준 보기에서 쓴다. bizNo는 숫자 10자리 */
  company: { bizNo: string; name?: string };
  /** AI 재검토. models는 공급자별 모델 ID(비면 실행 시 AI_MODEL_MISSING) */
  ai: { provider: AiProvider; mode: AiMode; models: Partial<Record<AiProvider, string>>; /** API 실행 시 문서 전문 전송(기본 true). false면 관련 구간만 */ sendFullText: boolean };
  /** 결과 추적 알림(팔로우 공고). expired도 final에 묶는다 */
  notify: { rank: boolean; final: boolean; deadline: boolean };
  updatedAt: ISODate;
}
// chrome.storage.local: { secrets: { g2bServiceKey?: string; ai?: Partial<Record<AiProvider, string>> }, settingsCache: Settings, registeredSites }
