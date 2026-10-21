import type { AttachResult, FieldResult } from '../../core/types/compose';

export interface RecipientSel { input: string; chip: string; chipEmail: string; commit: Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'>; }
export interface ComposeSelectorSet {
  id: string; version: string; status: 'unverified' | 'verified'; hostPattern: string;
  compose: { url?: string; openButton?: string; readySelector: string; inFrame?: string; scope?: string };
  to: RecipientSel; cc: RecipientSel & { revealButton?: string };
  subject: { input: string };
  body: {
    kind: 'contenteditable' | 'iframe' | 'textarea'; editable: string; iframe?: string; insert: Array<'execCommand' | 'paste' | 'innerHTML'>;
    /** 본문 칸 안에서 지우지 않을 요소(예: 서명). 있으면 그 앞부분만 바꾼다 */
    keep?: string;
  };
  attach: { /** 첨부 목록이 본문 iframe 문서 안에 있다(파일 칸은 바깥 문서) */ inBodyFrame?: boolean; fileInput?: string; dropZone?: string; item: string; itemName: string; itemSize?: string; itemProgress?: string; itemError?: string; uploadingClass?: string; pendingSelector?: string; blockingDialog?: string; limits?: { perFileBytes?: number; totalBytes?: number }; methods: Array<'input' | 'drop' | 'paste'> };
  draft?: { button: string; savedIndicator?: string };
  forbidden: { send: string[]; textPatterns: string[] /* 기본 ["보내기","전송","Send"] */ };
  /** 사용자가 직접 보냈는지 관찰하는 값(forbidden과 별개). send-watch.ts가 읽기만 한다. */
  sendWatch?: SendWatchConfig;
  /** 대시보드 [바로 발송]에서 확장이 눌러도 되는 유일한 요소(forbidden·sendWatch와 별개). send-trigger.ts만 쓴다 */
  autoSend?: { button: string; /** 화면 주소 목록(순서대로 받는사람, 참조, 숨은참조)과 그 안의 주소 칩. 있으면 클릭 직전에 칸별 대조 */ recipientLists?: { list: string; chip: string } };
}
export interface SendWatchConfig { buttons: string[]; textPatterns?: string[]; hotkey?: boolean; gone?: string; toast?: { selector: string; textPattern: string } }
export interface ComposeState {
  to: string[]; cc: string[]; subject: string; bodyText: string; bodyHtml: string;
  attachments: Array<{ name: string; size?: string; uploading: boolean }>;
  supported: { to: boolean; cc: boolean; subject: boolean; body: boolean; attachments: boolean };
}
export interface ComposeAnchor { subject?: string }
export interface ComposeAdapter {
  readonly id: string; readonly selectorSet: ComposeSelectorSet;
  /** reason: 'NOT_COMPOSE' | 'SELECTOR_MISSING' | 'FIELDS_NOT_FOUND' | 'SCOPE_NOT_FOUND' | 'SCOPE_AMBIGUOUS' 등. 진단과 메시지 분기용. */
  detect(): { isCompose: boolean; ready: boolean; reason?: string };
  waitReady(timeoutMs: number): Promise<void>;
  setRecipients(role: 'to' | 'cc', emails: string[]): Promise<FieldResult>;
  setSubject(text: string): Promise<FieldResult>;
  setBody(html: string): Promise<FieldResult>;
  attachFile(file: File, opts: { signal: AbortSignal; onPhase(p: 'injecting' | 'uploading'): void }): Promise<AttachResult>;
  readState(): ComposeState;
  saveDraft?(): Promise<FieldResult>;
}
