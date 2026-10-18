import type { AttachResult, FieldResult } from '../../core/types/compose';
import type { ComposeAdapter, ComposeSelectorSet, ComposeState, RecipientSel } from './types';
import {
  blurElement, click as safeClick, dropFiles, insertHtml, pasteFiles, pressKey, setInputFiles, setNativeValue, settle, typeText, waitFor,
} from './dom-actions';

export interface EngineTiming { settleMs?: number; stableMs?: number; pollMs?: number; itemAppearMs?: number }

const EMAIL_RE = /[^\s<>;,"'()]+@[^\s<>;,"'()]+/;
const norm = (s: string): string => s.replace(/\s+/g, '');

export class GenericComposeAdapter implements ComposeAdapter {
  readonly id: string;
  private readonly settleMs: number;
  private readonly stableMs: number;
  private readonly pollMs: number;
  private readonly itemAppearMs: number;

  constructor(readonly selectorSet: ComposeSelectorSet, private root: Document, timing: EngineTiming = {}) {
    this.id = selectorSet.id;
    this.settleMs = timing.settleMs ?? 400;
    this.stableMs = timing.stableMs ?? 1000;
    this.pollMs = timing.pollMs ?? 200;
    this.itemAppearMs = timing.itemAppearMs ?? 10_000;
  }

  // ---------- 탐색 ----------
  private q<T extends Element = HTMLElement>(sel: string, doc: Document = this.root): T | null {
    if (!sel) return null;
    try { return doc.querySelector<T>(sel); } catch { return null; }
  }
  private qa(sel: string, doc: Document = this.root): HTMLElement[] {
    if (!sel) return [];
    try { return Array.from(doc.querySelectorAll<HTMLElement>(sel)); } catch { return []; }
  }

  /** 본문이 들어 있는 문서. iframe 본문이 접근 불가면 null. */
  private resolveRoot(): Document | null {
    const b = this.selectorSet.body;
    if (b.kind !== 'iframe') return this.root;
    const f = this.q<HTMLIFrameElement>(b.iframe ?? '');
    return f?.contentDocument ?? null;
  }
  private bodyEditable(): HTMLElement | null {
    const doc = this.resolveRoot();
    return doc ? this.q(this.selectorSet.body.editable, doc) : null;
  }

  // ---------- 감지 ----------
  detect(): { isCompose: boolean; ready: boolean; reason?: string } {
    const s = this.selectorSet;
    if (!s.compose.readySelector) return { isCompose: false, ready: false, reason: 'SELECTOR_MISSING' };
    const isCompose = this.q(s.compose.readySelector) !== null;
    if (!isCompose) return { isCompose: false, ready: false, reason: 'NOT_COMPOSE' };
    if (!s.to.input || !s.subject.input || !s.body.editable) return { isCompose, ready: false, reason: 'SELECTOR_MISSING' };
    const ready = !!this.q(s.to.input) && !!this.q(s.subject.input) && !!this.bodyEditable();
    return { isCompose, ready, reason: ready ? undefined : 'FIELDS_NOT_FOUND' };
  }

  async waitReady(timeoutMs: number): Promise<void> {
    const ok = await waitFor(() => this.detect().ready, timeoutMs, this.pollMs);
    if (!ok) throw new Error('작성 화면이 준비되지 않았습니다.');
  }

  // ---------- 수신자 ----------
  private readChips(sel: RecipientSel): string[] {
    const out: string[] = [];
    for (const chip of this.qa(sel.chip)) {
      const emailEl = sel.chipEmail ? (chip.matches(sel.chipEmail) ? chip : chip.querySelector<HTMLElement>(sel.chipEmail)) : chip;
      const m = (emailEl?.textContent ?? '').match(EMAIL_RE);
      if (m) out.push(m[0].toLowerCase());
    }
    return out;
  }

  private async commit(input: HTMLElement, how: RecipientSel['commit'][number]): Promise<void> {
    if (how === 'enter') pressKey(input, 'Enter');
    else if (how === 'tab') pressKey(input, 'Tab');
    else if (how === 'semicolon') pressKey(input, ';');
    else if (how === 'comma') pressKey(input, ',');
    else blurElement(input);
  }

  async setRecipients(role: 'to' | 'cc', emails: string[]): Promise<FieldResult> {
    const sel = this.selectorSet[role];
    const base = { field: role, requested: emails, method: 'typeText' } as const;
    if (!sel.input || !sel.chip) return { ...base, rendered: null, status: 'unsupported', method: 'none', error: 'SELECTOR_MISSING' };
    try {
      let input = this.q(sel.input);
      if (!input && role === 'cc') {
        const reveal = this.q(this.selectorSet.cc.revealButton ?? '');
        if (reveal) { safeClick(reveal, this.selectorSet); await settle(this.settleMs); input = this.q(sel.input); }
      }
      if (!input) return { ...base, rendered: null, status: 'failed', error: 'INPUT_NOT_FOUND' };
      for (const email of emails) {
        const target = email.toLowerCase();
        if (this.readChips(sel).includes(target)) continue;
        input = this.q(sel.input) ?? input;
        typeText(input, email);
        for (const how of sel.commit) {
          await this.commit(input, how);
          await settle(this.settleMs);
          if (this.readChips(sel).includes(target)) break;
        }
      }
      const rendered = this.readChips(sel);
      const want = new Set(emails.map((e) => e.toLowerCase()));
      const got = new Set(rendered);
      const same = want.size === got.size && [...want].every((e) => got.has(e));
      return { ...base, rendered, status: same ? 'ok' : 'mismatch' };
    } catch (e) {
      return { ...base, rendered: null, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---------- 제목/본문 ----------
  async setSubject(text: string): Promise<FieldResult> {
    const base = { field: 'subject', requested: text, method: 'setNativeValue' } as const;
    if (!this.selectorSet.subject.input) return { ...base, rendered: null, status: 'unsupported', method: 'none', error: 'SELECTOR_MISSING' };
    const el = this.q<HTMLInputElement>(this.selectorSet.subject.input);
    if (!el) return { ...base, rendered: null, status: 'failed', error: 'INPUT_NOT_FOUND' };
    try {
      setNativeValue(el, text);
      await settle(this.settleMs);
      return { ...base, rendered: el.value, status: el.value.trim() === text.trim() ? 'ok' : 'mismatch' };
    } catch (e) {
      return { ...base, rendered: null, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  async setBody(html: string): Promise<FieldResult> {
    const b = this.selectorSet.body;
    const base = { field: 'body', requested: html, method: 'none' } as const;
    if (!b.editable || (b.kind === 'iframe' && !b.iframe)) return { ...base, rendered: null, status: 'unsupported', error: 'SELECTOR_MISSING' };
    if (this.resolveRoot() === null) return { ...base, rendered: null, status: 'unsupported', error: 'CROSS_ORIGIN_FRAME' };
    const el = this.bodyEditable();
    if (!el) return { ...base, rendered: null, status: 'failed', error: 'EDITABLE_NOT_FOUND' };
    try {
      const tpl = this.root.createElement('template');
      tpl.innerHTML = html;
      const wantText = tpl.content.textContent ?? '';
      let method: string | null;
      if (b.kind === 'textarea') {
        setNativeValue(el as unknown as HTMLTextAreaElement, wantText);
        method = 'setNativeValue';
      } else {
        method = insertHtml(el, html, b.insert);
      }
      await settle(this.settleMs);
      if (!method) return { ...base, rendered: null, status: 'failed', error: 'INSERT_FAILED' };
      const got = b.kind === 'textarea' ? (el as unknown as HTMLTextAreaElement).value : (el.textContent ?? '');
      return { ...base, method, rendered: got, status: norm(got) === norm(wantText) ? 'ok' : 'mismatch' };
    } catch (e) {
      return { ...base, rendered: null, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---------- 첨부 ----------
  private findItem(name: string): HTMLElement | null {
    const a = this.selectorSet.attach;
    for (const item of this.qa(a.item)) {
      const nameEl = a.itemName ? (item.matches(a.itemName) ? item : item.querySelector<HTMLElement>(a.itemName)) : item;
      if ((nameEl?.textContent ?? '').trim().includes(name)) return item;
    }
    return null;
  }
  private itemUploading(item: HTMLElement): boolean {
    const a = this.selectorSet.attach;
    if (a.itemProgress && item.querySelector(a.itemProgress)) return true;
    if (a.uploadingClass && item.classList.contains(a.uploadingClass)) return true;
    return false;
  }
  private itemError(item: HTMLElement): boolean {
    const a = this.selectorSet.attach;
    return !!a.itemError && (item.matches(a.itemError) || !!item.querySelector(a.itemError));
  }

  async attachFile(file: File, opts: { signal: AbortSignal; onPhase(p: 'injecting' | 'uploading'): void }): Promise<AttachResult> {
    const a = this.selectorSet.attach;
    const t0 = Date.now();
    const fileId = `${file.name}:${file.size}`;
    const res = (status: AttachResult['status'], method: AttachResult['method'], extra: Partial<AttachResult> = {}): AttachResult =>
      ({ fileId, name: file.name, size: file.size, status, method, elapsedMs: Date.now() - t0, ...extra });
    if (!a.item || a.methods.length === 0) return res('skipped', 'none', { error: 'SELECTOR_MISSING' });

    opts.onPhase('injecting');
    let used: AttachResult['method'] | null = null;
    for (const m of a.methods) {
      if (opts.signal.aborted) return res('failed', 'none', { error: 'ABORTED' });
      try {
        if (m === 'input') {
          const input = this.q<HTMLInputElement>(a.fileInput ?? '');
          if (!input) continue;
          setInputFiles(input, [file]);
        } else if (m === 'drop') {
          const zone = this.q(a.dropZone ?? '');
          if (!zone) continue;
          dropFiles(zone, [file]);
        } else {
          const target = this.q(a.dropZone ?? '') ?? this.bodyEditable();
          if (!target) continue;
          pasteFiles(target, [file]);
        }
      } catch { continue; }
      used = m;
      await settle(this.settleMs);
      if (await waitFor(() => opts.signal.aborted || this.findItem(file.name), this.itemAppearMs, this.pollMs)) break;
    }
    if (!used) return res('failed', 'none', { error: 'NO_INJECTION_PATH' });

    opts.onPhase('uploading');
    const timeoutMs = Math.max(60_000, (file.size / (100 * 1024)) * 1000);
    const end = t0 + timeoutMs;
    let stableSince: number | null = null;
    let last: HTMLElement | null = null;
    while (Date.now() < end) {
      if (opts.signal.aborted) return res('failed', used, { error: 'ABORTED' });
      const item = this.findItem(file.name);
      last = item;
      if (item && this.itemError(item)) return res('failed', used, { error: 'UPLOAD_ERROR' });
      if (item && !this.itemUploading(item)) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= this.stableMs) {
          const nameEl = a.itemName ? item.querySelector<HTMLElement>(a.itemName) ?? item : item;
          const sizeText = a.itemSize ? item.querySelector<HTMLElement>(a.itemSize)?.textContent?.trim() : undefined;
          return res('uploaded', used, { renderedName: (nameEl.textContent ?? '').trim(), ...(sizeText ? { renderedSize: sizeText } : {}) });
        }
      } else {
        stableSince = null;
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    return last ? res('uploading_timeout', used) : res('not_in_dom', used);
  }

  // ---------- 상태 ----------
  readState(): ComposeState {
    const s = this.selectorSet;
    const subj = this.q<HTMLInputElement>(s.subject.input);
    const body = this.bodyEditable();
    const bodyText = body ? (body instanceof HTMLTextAreaElement ? body.value : body.textContent ?? '') : '';
    return {
      to: this.readChips(s.to),
      cc: this.readChips(s.cc),
      subject: subj?.value ?? '',
      bodyText,
      bodyHtml: body && !(body instanceof HTMLTextAreaElement) ? body.innerHTML : bodyText,
      attachments: this.qa(s.attach.item).map((item) => {
        const nameEl = s.attach.itemName ? item.matches(s.attach.itemName) ? item : item.querySelector<HTMLElement>(s.attach.itemName) : item;
        const size = s.attach.itemSize ? item.querySelector<HTMLElement>(s.attach.itemSize)?.textContent?.trim() : undefined;
        return { name: (nameEl?.textContent ?? '').trim(), ...(size ? { size } : {}), uploading: this.itemUploading(item) };
      }),
    };
  }
}
