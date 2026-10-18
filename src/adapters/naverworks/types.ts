import type { AttachResult, FieldResult } from '../../core/types/compose';

export interface RecipientSel { input: string; chip: string; chipEmail: string; commit: Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'>; }
export interface ComposeSelectorSet {
  id: string; version: string; status: 'unverified' | 'verified'; hostPattern: string;
  compose: { url?: string; openButton?: string; readySelector: string; inFrame?: string };
  to: RecipientSel; cc: RecipientSel & { revealButton?: string };
  subject: { input: string };
  body: { kind: 'contenteditable' | 'iframe' | 'textarea'; editable: string; iframe?: string; insert: Array<'execCommand' | 'paste' | 'innerHTML'> };
  attach: { fileInput?: string; dropZone?: string; item: string; itemName: string; itemSize?: string; itemProgress?: string; itemError?: string; uploadingClass?: string; methods: Array<'input' | 'drop' | 'paste'> };
  draft?: { button: string; savedIndicator?: string };
  forbidden: { send: string[]; textPatterns: string[] /* 기본 ["보내기","전송","Send"] */ };
}
export interface ComposeState {
  to: string[]; cc: string[]; subject: string; bodyText: string; bodyHtml: string;
  attachments: Array<{ name: string; size?: string; uploading: boolean }>;
}
export interface ComposeAdapter {
  readonly id: string; readonly selectorSet: ComposeSelectorSet;
  detect(): { isCompose: boolean; ready: boolean; reason?: string };
  waitReady(timeoutMs: number): Promise<void>;
  setRecipients(role: 'to' | 'cc', emails: string[]): Promise<FieldResult>;
  setSubject(text: string): Promise<FieldResult>;
  setBody(html: string): Promise<FieldResult>;
  attachFile(file: File, opts: { signal: AbortSignal; onPhase(p: 'injecting' | 'uploading'): void }): Promise<AttachResult>;
  readState(): ComposeState;
  saveDraft?(): Promise<FieldResult>;
}
