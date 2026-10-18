import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// 읽기/관찰 전용 진단 스크립트. click/dispatchEvent/키 입력을 하지 않는다.

type Json = Record<string, unknown>;

interface ProbeApi {
  snapshot(): Json;
  startRecording(): Json;
  stopRecording(): Json;
  status(): Json;
}

declare global {
  interface Window { __bidMateProbe?: ProbeApi }
}

const MAX_RECORDS = 5000;
const MAX_PER_CATEGORY = 500;

import { maskDeep, maskStr, truncateMasked } from '../core/privacy/mask';

// ---------- DOM 유틸 ----------
const esc = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));

function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : document;
}

/** id 우선, 없으면 nth-of-type 체인. 열린 shadowRoot 경계는 " >> "로 잇는다. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const root = rootOf(cur);
    let seg: string | null = null;
    let node: Element | null = cur;
    const chain: string[] = [];
    while (node) {
      if (node.id) {
        const sel = `#${esc(node.id)}`;
        if (root.querySelectorAll(sel).length === 1) {
          chain.unshift(sel);
          break;
        }
      }
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (!parent) {
        chain.unshift(tag);
        break;
      }
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      seg = same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag;
      chain.unshift(seg);
      node = parent;
    }
    parts.unshift(chain.join(' > '));
    const r = cur.getRootNode();
    cur = r instanceof ShadowRoot ? r.host : null;
  }
  return parts.join(' >> ');
}

function* walk(root: Document | ShadowRoot | Element): Generator<Element> {
  const list = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(root.querySelectorAll('*'));
  for (const el of list) {
    yield el;
    if (el.shadowRoot) yield* walk(el.shadowRoot);
  }
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
}

function outerHtml(el: Element): string {
  // 비활성 문서의 template.content에서 입력값(value 속성/textarea 텍스트)을 제거한 뒤 직렬화한다.
  // 이미지 로드/커스텀 엘리먼트 생성자가 실행되지 않고 원본 DOM도 건드리지 않는다.
  const tpl = document.implementation.createHTMLDocument('').createElement('template');
  tpl.innerHTML = el.outerHTML.slice(0, 20000);
  for (const t of Array.from(tpl.content.querySelectorAll('input, textarea, select'))) {
    t.removeAttribute('value');
    if (t.tagName === 'TEXTAREA') t.textContent = '';
  }
  const html = Array.from(tpl.content.childNodes)
    .map((n) => (n instanceof Element ? n.outerHTML : (n.textContent ?? '')))
    .join('');
  return truncateMasked(html, 300);
}

function describe(el: Element): Json {
  const aria: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (a.name.startsWith('aria-')) aria[a.name] = maskStr(a.value);
  const r = el.getBoundingClientRect();
  const out: Json = {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    id: el.id || null,
    name: el.getAttribute('name'),
    className: el.getAttribute('class'),
    placeholder: el.getAttribute('placeholder'),
    aria,
    role: el.getAttribute('role'),
    contenteditable: el.getAttribute('contenteditable'),
    visible: isVisible(el),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    cssPath: cssPath(el),
    outerHTML: outerHtml(el),
  };
  if (el instanceof HTMLInputElement && el.type === 'file') {
    out.accept = el.getAttribute('accept');
    out.multiple = el.multiple;
  }
  if (el instanceof HTMLIFrameElement || el.tagName === 'FRAME') out.src = el.getAttribute('src');
  return out;
}

const textOf = (el: Element, n: number): string => truncateMasked((el.textContent ?? '').replace(/\s+/g, ' ').trim(), n);

// ---------- tables / links (읽기 전용) ----------
const cellText = (el: Element, n: number): string => textOf(el, n);

function collectTables(): Json[] {
  const out: Json[] = [];
  for (const el of walk(document)) {
    if (!(el instanceof HTMLTableElement)) continue;
    if (out.length >= 50) break;
    const rows = Array.from(el.rows);
    out.push({
      caption: el.caption ? textOf(el.caption, 80) : null,
      headers: Array.from(el.querySelectorAll('th')).slice(0, 40).map((th) => cellText(th, 80)),
      rowCount: rows.length,
      firstRows: rows.slice(0, 3).map((r) => Array.from(r.cells).map((c) => cellText(c, 80))),
      cssPath: cssPath(el),
    });
  }
  return out;
}

function collectLinks(): Json[] {
  const out: Json[] = [];
  for (const el of walk(document)) {
    if (out.length >= 500) break;
    const onclick = el.getAttribute('onclick');
    if (!(el.tagName === 'A' && el.hasAttribute('href')) && onclick === null) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      text: textOf(el, 60),
      href: el.getAttribute('href'),
      onclick: onclick === null ? null : truncateMasked(onclick, 200),
      cssPath: cssPath(el),
    });
  }
  return out;
}

// ---------- snapshot ----------
const EDITOR_HINTS: Array<{ name: string; selector: string }> = [
  { name: 'ProseMirror', selector: '.ProseMirror' },
  { name: 'ql-editor', selector: '.ql-editor' },
  { name: 'fr-element', selector: '.fr-element' },
  { name: 'se2', selector: '[class*="se2"], [id*="se2"]' },
  { name: 'smarteditor', selector: '[class*="smarteditor" i], [id*="smarteditor" i]' },
  { name: 'tox', selector: '.tox, .tox-edit-area, .mce-content-body' },
  { name: 'cke', selector: '.cke, .cke_editable, [class*="cke_"]' },
  { name: 'contenteditable=true', selector: '[contenteditable="true"], [contenteditable=""]' },
];
const SEND_RE = /보내기|전송|Send/i;

function snapshot(): Json {
  const inputs: Element[] = [];
  const editables: Element[] = [];
  const buttons: Element[] = [];
  const fileInputs: Element[] = [];
  const iframes: Element[] = [];
  const shadowHosts: Element[] = [];
  const hintMatches = new Map<string, Element[]>(EDITOR_HINTS.map((h) => [h.name, []]));
  const sends: Array<{ el: Element; matchedBy: string }> = [];

  for (const el of walk(document)) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (el instanceof HTMLInputElement && type === 'file') fileInputs.push(el);
    else if (tag === 'INPUT' && (type === 'button' || type === 'submit' || type === 'reset' || type === 'image')) buttons.push(el);
    else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') inputs.push(el);
    else if (tag === 'BUTTON' || el.getAttribute('role') === 'button') buttons.push(el);
    if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') editables.push(el);
    if (tag === 'IFRAME' || tag === 'FRAME') iframes.push(el);
    if (el.shadowRoot) shadowHosts.push(el);
    for (const h of EDITOR_HINTS) if (el.matches(h.selector)) hintMatches.get(h.name)!.push(el);

    const label = el.getAttribute('aria-label') ?? '';
    const title = el.getAttribute('title') ?? '';
    const own = tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HTML' || tag === 'BODY' ? '' : textOf(el, 41);
    const by = SEND_RE.test(label) ? 'aria-label' : SEND_RE.test(title) ? 'title' : own.length <= 40 && SEND_RE.test(own) ? 'text' : null;
    if (by && sends.length < 100) sends.push({ el, matchedBy: by });
  }

  const cap = (list: Element[]) => list.slice(0, MAX_PER_CATEGORY).map(describe);
  const report: Json = {
    url: location.href,
    title: document.title,
    ts: new Date().toISOString(),
    ua: navigator.userAgent,
    isTop: window === window.top,
    elements: {
      inputs: cap(inputs),
      editables: cap(editables),
      buttons: cap(buttons),
      fileInputs: cap(fileInputs),
      iframes: cap(iframes),
      shadowHosts: cap(shadowHosts),
    },
    editorHints: EDITOR_HINTS.map((h) => ({
      name: h.name,
      selector: h.selector,
      count: hintMatches.get(h.name)!.length,
      samples: hintMatches.get(h.name)!.slice(0, 5).map(describe),
    })),
    tables: collectTables(),
    links: collectLinks(),
    sendCandidates: sends.map((s) => ({ ...describe(s.el), matchedBy: s.matchedBy, text: textOf(s.el, 40) })),
  };
  return maskDeep(report);
}

// ---------- recording ----------
interface Recording {
  startedAt: number;
  mutations: Json[];
  resources: Json[];
  events: Json[];
  truncated: { mutations: boolean; events: boolean; resources: boolean };
  mo: MutationObserver;
  po: PerformanceObserver | null;
  stopListeners: Array<() => void>;
}

let rec: Recording | null = null;

function summarizeNode(n: Node): Json | null {
  if (!(n instanceof Element)) return null;
  return { tag: n.tagName.toLowerCase(), class: n.getAttribute('class'), text: textOf(n, 40) };
}

function realTarget(e: Event): Element | null {
  const t = (e.composedPath()[0] ?? e.target) as Node | null;
  return t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
}

function startRecording(): Json {
  if (rec) return { ok: true, alreadyRecording: true, startedAt: rec.startedAt };
  const startedAt = Date.now();
  const now = () => Date.now() - startedAt;

  const mutations: Json[] = [];
  const resources: Json[] = [];
  const events: Json[] = [];
  const pushEvent = (item: Json) => {
    if (events.length >= MAX_RECORDS) {
      if (rec) rec.truncated.events = true;
      return;
    }
    events.push(item);
  };

  const mo = new MutationObserver((records) => {
    for (const m of records) {
      if (mutations.length >= MAX_RECORDS) {
        if (rec) rec.truncated.mutations = true;
        return;
      }
      if (m.type === 'childList') {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element) for (const el of walk(n)) if (el.shadowRoot) observeRoot(el.shadowRoot);
        }
      }
      const target = m.target instanceof Element ? m.target : m.target.parentElement;
      const item: Json = { t: now(), target: target ? cssPath(target) : null, type: m.type };
      if (m.type === 'childList') {
        const added = Array.from(m.addedNodes).map(summarizeNode).filter(Boolean).slice(0, 10);
        const removed = Array.from(m.removedNodes).map(summarizeNode).filter(Boolean).slice(0, 10);
        if (added.length === 0 && removed.length === 0) continue;
        item.added = added;
        item.removed = removed;
      } else if (m.type === 'attributes' && m.target instanceof Element) {
        const name = m.attributeName ?? '';
        item.attr = {
          name,
          // input의 value는 수집하지 않는다.
          value: name === 'value' ? null : truncateMasked(m.target.getAttribute(name) ?? '', 120),
        };
      }
      mutations.push(item);
    }
  });
  const observed = new WeakSet<Node>();
  const opts = { subtree: true, childList: true, attributes: true, characterData: false };
  const observeRoot = (n: Node) => {
    if (observed.has(n)) return;
    observed.add(n);
    mo.observe(n, opts);
  };
  observeRoot(document.documentElement);
  for (const el of walk(document)) if (el.shadowRoot) observeRoot(el.shadowRoot);

  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (resources.length >= MAX_RECORDS) {
          if (rec) rec.truncated.resources = true;
          break;
        }
        resources.push({
          t: Math.round(performance.timeOrigin + e.startTime - startedAt),
          name: e.name,
          initiatorType: e.initiatorType,
          duration: Math.round(e.duration),
          transferSize: e.transferSize,
        });
      }
    });
    po.observe({ type: 'resource', buffered: false });
  } catch {
    po = null;
  }

  const stopListeners: Array<() => void> = [];
  const on = (type: string, fn: (e: Event) => void) => {
    window.addEventListener(type, fn, { capture: true, passive: true });
    stopListeners.push(() => window.removeEventListener(type, fn, { capture: true }));
  };
  const base = (type: string, e: Event): Json => {
    const t = realTarget(e);
    return { t: now(), type, target: t ? cssPath(t) : null };
  };

  on('focusin', (e) => pushEvent(base('focusin', e)));
  on('keydown', (e) => {
    const k = e as KeyboardEvent;
    pushEvent({
      ...base('keydown', e),
      key: k.key.length > 1 ? k.key : 'char', // 인쇄 가능 문자는 내용을 기록하지 않는다.
      mods: { ctrl: k.ctrlKey, shift: k.shiftKey, alt: k.altKey, meta: k.metaKey },
    });
  });
  on('input', (e) => pushEvent({ ...base('input', e), inputType: (e as InputEvent).inputType }));
  on('change', (e) => {
    const item = base('change', e);
    const t = realTarget(e);
    if (t instanceof HTMLInputElement && t.type === 'file') {
      item.files = Array.from(t.files ?? []).map((f) => ({ name: f.name, size: f.size }));
    }
    pushEvent(item);
  });
  on('paste', (e) => {
    const dt = (e as ClipboardEvent).clipboardData;
    pushEvent({ ...base('paste', e), types: Array.from(dt?.types ?? []), fileCount: dt?.files.length ?? 0 });
  });
  on('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    pushEvent({ ...base('drop', e), types: Array.from(dt?.types ?? []), fileCount: dt?.files.length ?? 0 });
  });
  let dragoverLogged = false;
  on('dragover', (e) => {
    if (dragoverLogged) return;
    dragoverLogged = true;
    pushEvent(base('dragover', e));
  });
  on('click', (e) => {
    const t = realTarget(e);
    pushEvent({ ...base('click', e), text: t ? textOf(t, 30) : '' });
  });

  rec = { startedAt, mutations, resources, events, truncated: { mutations: false, events: false, resources: false }, mo, po, stopListeners };
  return { ok: true, startedAt };
}

function stopRecording(): Json {
  if (!rec) return maskDeep({ url: location.href, recording: false, mutations: [], resources: [], events: [] });
  const r = rec;
  rec = null;
  r.mo.disconnect();
  r.po?.disconnect();
  r.stopListeners.forEach((f) => f());
  return maskDeep({
    url: location.href,
    isTop: window === window.top,
    startedAt: new Date(r.startedAt).toISOString(),
    durationMs: Date.now() - r.startedAt,
    truncated: r.truncated,
    mutations: r.mutations,
    resources: r.resources,
    events: r.events,
  });
}

function status(): Json {
  return rec
    ? { recording: true, startedAt: rec.startedAt, events: rec.events.length, mutations: rec.mutations.length, resources: rec.resources.length }
    : { recording: false, events: 0, mutations: 0, resources: 0 };
}

export default defineUnlistedScript(() => {
  if (window.__bidMateProbe) return; // 중복 주입 시 기존 인스턴스 유지
  window.__bidMateProbe = { snapshot, startRecording, stopRecording, status };
});
