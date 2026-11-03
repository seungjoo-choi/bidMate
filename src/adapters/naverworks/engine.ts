import type { AttachResult, FieldResult } from '../../core/types/compose';
import type { ComposeAdapter, ComposeAnchor, ComposeSelectorSet, ComposeState, RecipientSel } from './types';
import {
  blurElement, click as safeClick, dropFiles, insertHtml, pasteFiles, pressKey, setInputFiles, setNativeValue, settle, typeText, waitFor,
} from './dom-actions';

export interface EngineTiming { settleMs?: number; stableMs?: number; pollMs?: number; itemAppearMs?: number }

const EMAIL_RE = /[^\s<>;,"'()]+@[^\s<>;,"'()]+/;
const norm = (s: string): string => s.replace(/\s+/g, '');
/** 파일 이름 대조용: 공백과 점을 빼고 소문자로. */
const flatName = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
/** 화면 이름이 파일 이름과 같은지. 이름과 확장자가 나뉘어 점이 빠진 화면("보고서"+"pdf")도 같다고 본다. */
function sameFileName(shown: string, name: string): boolean {
  const d = flatName(shown);
  const n = flatName(name);
  return d === n || d === n.replace(/\.(?=[^.]*$)/, '');
}
/** 항목 설명에 파일 이름이 들어 있는지. 앞뒤가 이름 글자로 이어지면 다른 파일로 본다("aa.pdf" 안의 "a.pdf"). */
function labelHasName(label: string, name: string): boolean {
  const l = flatName(label);
  const n = flatName(name);
  if (!n) return false;
  const nameChar = /[\p{L}\p{N}_-]/u;
  for (let i = l.indexOf(n); i !== -1; i = l.indexOf(n, i + 1)) {
    const before = i > 0 ? l[i - 1] : '';
    const after = l[i + n.length] ?? '';
    if (!(before && (nameChar.test(before) || before === '.')) && !(after && nameChar.test(after))) return true;
  }
  return false;
}
/** keep 요소(서명 등)를 뺀 본문 복제본. */
function withoutKeep(el: HTMLElement, keep: string | undefined): HTMLElement {
  if (!keep) return el;
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll(keep).forEach((k) => k.remove());
  return c;
}
/** keep 요소(서명 등)를 뺀 본문 텍스트. */
function textWithoutKeep(el: HTMLElement, keep: string | undefined): string {
  return withoutKeep(el, keep).textContent ?? '';
}

export class GenericComposeAdapter implements ComposeAdapter {
  readonly id: string;
  private readonly settleMs: number;
  private readonly stableMs: number;
  private readonly pollMs: number;
  private readonly itemAppearMs: number;

  private pinned: Element | null = null;
  private lost = false;

  constructor(readonly selectorSet: ComposeSelectorSet, private root: Document, timing: EngineTiming = {}, private anchor?: ComposeAnchor) {
    this.id = selectorSet.id;
    this.settleMs = timing.settleMs ?? 400;
    this.stableMs = timing.stableMs ?? 1000;
    this.pollMs = timing.pollMs ?? 200;
    this.itemAppearMs = timing.itemAppearMs ?? 10_000;
  }

  // ---------- 탐색 ----------
  private scopeCandidates(): HTMLElement[] {
    return this.qaIn(this.root, this.selectorSet.compose.scope ?? '');
  }
  private qaIn(base: ParentNode, sel: string): HTMLElement[] {
    if (!sel) return [];
    try { return Array.from(base.querySelectorAll<HTMLElement>(sel)); } catch { return []; }
  }

  /** 작성 창 범위. scope가 없으면 문서 전체. 끊어진 pin은 1회 재해석한다. */
  resolveScope(): { el: ParentNode | null; reason?: 'SCOPE_NOT_FOUND' | 'SCOPE_AMBIGUOUS' } {
    const scope = this.selectorSet.compose.scope;
    if (!scope) return { el: this.root };
    const want = (this.anchor?.subject ?? '').replace(/\s+/g, ' ').trim();
    if (this.pinned) {
      if (this.pinned.isConnected) return { el: this.pinned };
      this.pinned = null;
      this.lost = true;
    }
    // 제목 앵커 없이 잃은 창은 다시 고르지 않는다(남은 후보가 다른 창일 수 있음)
    if (this.lost && !want) return { el: null };
    let cands = this.scopeCandidates();
    if (want) {
      const subjSel = this.selectorSet.subject.input;
      cands = cands.filter((c) => {
        const inp = subjSel ? this.qIn<HTMLInputElement>(c, subjSel) : null;
        return !!inp && inp.value.replace(/\s+/g, ' ').trim() === want;
      });
    }
    if (cands.length === 0) return { el: null, reason: 'SCOPE_NOT_FOUND' };
    if (cands.length > 1) return { el: null, reason: 'SCOPE_AMBIGUOUS' };
    this.pinned = cands[0]!;
    this.lost = false;
    return { el: this.pinned };
  }
  /** scope 해석 실패 사유. pin이 끊어진 뒤 재해석 실패면 SCOPE_LOST. */
  private scopeError(): string {
    return this.lost ? 'SCOPE_LOST' : (this.resolveScope().reason ?? 'SCOPE_NOT_FOUND');
  }

  private qIn<T extends Element = HTMLElement>(base: ParentNode, sel: string): T | null {
    if (!sel) return null;
    try { return base.querySelector<T>(sel); } catch { return null; }
  }
  private q<T extends Element = HTMLElement>(sel: string, doc?: ParentNode): T | null {
    const base = doc ?? this.resolveScope().el;
    return base ? this.qIn<T>(base, sel) : null;
  }
  private qa(sel: string, doc?: ParentNode): HTMLElement[] {
    const base = doc ?? this.resolveScope().el;
    return base ? this.qaIn(base, sel) : [];
  }

  /** 본문을 찾을 기준. iframe이 아니면 작성 창 범위(해석 실패 시 null), iframe 본문이 접근 불가면 null. */
  private resolveRoot(): ParentNode | null {
    const b = this.selectorSet.body;
    if (b.kind !== 'iframe') return this.resolveScope().el;
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
    if (s.compose.scope) {
      const isCompose = this.scopeCandidates().length >= 1;
      if (!isCompose) return { isCompose: false, ready: false, reason: 'SCOPE_NOT_FOUND' };
      const sc = this.resolveScope();
      if (!sc.el) return { isCompose, ready: false, reason: this.scopeError() };
      const need: Array<() => boolean> = [];
      if (s.to.input) need.push(() => !!this.q(s.to.input));
      if (s.subject.input) need.push(() => !!this.q(s.subject.input));
      if (s.body.editable) need.push(() => !!this.bodyEditable());
      if (need.length === 0) return { isCompose, ready: false, reason: 'SELECTOR_MISSING' };
      const ready = need.every((f) => f());
      return { isCompose, ready, reason: ready ? undefined : 'FIELDS_NOT_FOUND' };
    }
    if (!s.compose.readySelector) return { isCompose: false, ready: false, reason: 'SELECTOR_MISSING' };
    const isCompose = this.q(s.compose.readySelector) !== null;
    if (!isCompose) return { isCompose: false, ready: false, reason: 'NOT_COMPOSE' };
    // 받는 사람은 주소로 채우는 서비스(네이버웍스)가 있어 셀렉터가 있을 때만 요구한다
    if (!s.subject.input || !s.body.editable) return { isCompose, ready: false, reason: 'SELECTOR_MISSING' };
    const ready = (!s.to.input || !!this.q(s.to.input)) && !!this.q(s.subject.input) && !!this.bodyEditable();
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
    if (this.resolveRoot() === null) {
      return b.kind === 'iframe'
        ? { ...base, rendered: null, status: 'unsupported', error: 'CROSS_ORIGIN_FRAME' }
        : { ...base, rendered: null, status: 'failed', error: this.scopeError() };
    }
    const el = this.bodyEditable();
    if (!el) return { ...base, rendered: null, status: 'failed', error: 'EDITABLE_NOT_FOUND' };
    const hadKeep = !!b.keep && b.kind !== 'textarea' && !!el.querySelector(b.keep);
    try {
      const tpl = this.root.createElement('template');
      tpl.innerHTML = html;
      const wantText = tpl.content.textContent ?? '';
      let method: string | null;
      if (b.kind === 'textarea') {
        setNativeValue(el as unknown as HTMLTextAreaElement, wantText);
        method = 'setNativeValue';
      } else {
        method = insertHtml(el, html, b.insert, b.keep);
      }
      await settle(this.settleMs);
      if (!method) return { ...base, rendered: null, status: 'failed', error: 'INSERT_FAILED' };
      const got = b.kind === 'textarea' ? (el as unknown as HTMLTextAreaElement).value : textWithoutKeep(el, b.keep);
      // 서명 등 keep 요소가 삽입 중 사라졌으면 불일치로 본다
      if (hadKeep && !el.querySelector(b.keep!)) return { ...base, method, rendered: got, status: 'mismatch', error: 'KEEP_LOST' };
      return { ...base, method, rendered: got, status: norm(got) === norm(wantText) ? 'ok' : 'mismatch' };
    } catch (e) {
      return { ...base, rendered: null, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---------- 첨부 ----------
  /** 첨부 목록을 찾을 기준. inBodyFrame이면 본문 iframe 문서(접근 불가면 null). */
  private attachBase(): ParentNode | null {
    return this.selectorSet.attach.inBodyFrame ? this.resolveRoot() : this.resolveScope().el;
  }
  private attachItems(): HTMLElement[] {
    const base = this.attachBase();
    return base ? this.qaIn(base, this.selectorSet.attach.item) : [];
  }
  /** 이름이 같은 첨부 항목. existing(주입 전부터 있던 항목)은 새 첨부로 보지 않는다. */
  private findItem(name: string, existing?: Set<HTMLElement>): HTMLElement | null {
    const a = this.selectorSet.attach;
    for (const item of this.attachItems()) {
      if (existing?.has(item)) continue;
      const label = a.itemLabelAttr ? item.getAttribute(a.itemLabelAttr) : null;
      if (label !== null) {
        if (labelHasName(label, name)) return item;
        continue;
      }
      const nameEl = a.itemName ? (item.matches(a.itemName) ? item : item.querySelector<HTMLElement>(a.itemName)) : item;
      if (sameFileName(nameEl?.textContent ?? '', name)) return item;
    }
    return null;
  }
  private itemUploading(item: HTMLElement): boolean {
    const a = this.selectorSet.attach;
    if (a.itemDone && !item.querySelector(a.itemDone)) return true;
    if (a.itemProgress && item.querySelector(a.itemProgress)) return true;
    if (a.uploadingClass && item.classList.contains(a.uploadingClass)) return true;
    if (a.pendingSelector) {
      const base = this.attachBase();
      if (base && this.qIn(base, a.pendingSelector) !== null) return true;
    }
    return false;
  }
  private dialogShown(): boolean {
    const d = this.selectorSet.attach.blockingDialog;
    return !!d && this.qIn(this.root, d) !== null;
  }
  private dropTarget(): HTMLElement | null {
    const z = this.selectorSet.attach.dropZone ?? '';
    if (z === ':scope' && this.selectorSet.compose.scope) return this.resolveScope().el as HTMLElement | null;
    return this.q(z);
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

    if (!this.resolveScope().el) return res('failed', 'none', { error: this.scopeError() });

    // 주입 전부터 있던 항목(같은 이름 재첨부, 이전 실행분)을 새 첨부로 오인하지 않게 기억한다
    const existing = new Set(this.attachItems());
    // 한도를 넘겨 Drive 링크 등으로 바뀐 경우를 잡으려고 주입 전 표식 개수를 기억한다
    const converted0 = a.convertedMarker ? this.qa(a.convertedMarker).length : 0;
    const converted = (): boolean => !!a.convertedMarker && this.qa(a.convertedMarker).length > converted0;
    const blocked = (): string | null => (converted() ? 'DRIVE_CONVERTED' : this.dialogShown() ? 'DIALOG_SHOWN' : null);
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
          const zone = this.dropTarget();
          if (!zone) continue;
          dropFiles(zone, [file]);
        } else {
          const target = this.dropTarget() ?? this.bodyEditable();
          if (!target) continue;
          pasteFiles(target, [file]);
        }
      } catch { continue; }
      used = m;
      await settle(this.settleMs);
      const b0 = blocked();
      if (b0) return res('failed', used, { error: b0 });
      if (await waitFor(() => opts.signal.aborted || blocked() !== null || this.findItem(file.name, existing), this.itemAppearMs, this.pollMs)) {
        const b1 = blocked();
        if (b1) return res('failed', used, { error: b1 });
        break;
      }
    }
    if (!used) return res('failed', 'none', { error: 'NO_INJECTION_PATH' });

    opts.onPhase('uploading');
    const timeoutMs = Math.max(60_000, (file.size / (100 * 1024)) * 1000);
    const end = t0 + timeoutMs;
    let stableSince: number | null = null;
    let last: HTMLElement | null = null;
    while (Date.now() < end) {
      if (opts.signal.aborted) return res('failed', used, { error: 'ABORTED' });
      const b2 = blocked();
      if (b2) return res('failed', used, { error: b2 });
      if (!this.resolveScope().el) return res('failed', used, { error: this.scopeError() });
      const item = this.findItem(file.name, existing);
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
    if (!this.resolveScope().el) {
      return {
        to: [], cc: [], subject: '', bodyText: '', bodyHtml: '', attachments: [],
        supported: { to: false, cc: false, subject: false, body: false, attachments: false },
      };
    }
    const subj = this.q<HTMLInputElement>(s.subject.input);
    const body = this.bodyEditable();
    // 서명 등 keep 요소는 대조에서 뺀다(서명 표 때문에 길이 검사가 늘 통과하지 않게)
    const bodyEl = body && !(body instanceof HTMLTextAreaElement) ? withoutKeep(body, s.body.keep) : null;
    const bodyText = body ? (body instanceof HTMLTextAreaElement ? body.value : bodyEl!.textContent ?? '') : '';
    return {
      to: this.readChips(s.to),
      cc: this.readChips(s.cc),
      subject: subj?.value ?? '',
      bodyText,
      bodyHtml: bodyEl ? bodyEl.innerHTML : bodyText,
      attachments: this.attachItems().map((item) => {
        const nameEl = s.attach.itemName ? item.matches(s.attach.itemName) ? item : item.querySelector<HTMLElement>(s.attach.itemName) : item;
        const size = s.attach.itemSize ? item.querySelector<HTMLElement>(s.attach.itemSize)?.textContent?.trim() : undefined;
        return { name: (nameEl?.textContent ?? '').trim(), ...(size ? { size } : {}), uploading: this.itemUploading(item) };
      }),
      supported: {
        // 수신자는 칩으로 읽으므로 칩 셀렉터가 있어야 대조할 수 있다
        to: !!s.to.chip, cc: !!s.cc.chip, subject: !!s.subject.input,
        body: !!s.body.editable && (s.body.kind !== 'iframe' || !!s.body.iframe),
        attachments: !!s.attach.item && s.attach.methods.length > 0,
      },
    };
  }
}
