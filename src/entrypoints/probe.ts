import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// 읽기/관찰 전용 진단 스크립트. click/dispatchEvent/키 입력을 하지 않는다.

type Json = Record<string, unknown>;

export interface InspectOpts { depth?: number; maxMatches?: number }
export interface WatchOpts { selectors: string[]; intervalMs?: number }
export interface RecordingOpts { watch?: WatchOpts }

interface ProbeApi {
  snapshot(): Json;
  inspect(selectors: string[], opts?: InspectOpts): Json;
  startRecording(opts?: RecordingOpts): Json;
  stopRecording(): Json;
  status(): Json;
}

declare global {
  interface Window { __bidMateProbe?: ProbeApi }
}

const MAX_RECORDS = 5000;
const MAX_PER_CATEGORY = 500;
const MAX_WATCHES = 200;
const MAX_CHILDREN = 30;

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

// ---------- inspect (읽기 전용) ----------
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

/** 요소 자신의 직접 텍스트 노드만 40자 이하로 모은다(자손 텍스트는 자식 노드에서 따로 기록). */
function ownText(el: Element): string {
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? '';
  return truncateMasked(t.replace(/\s+/g, ' ').trim(), 40);
}

function subtreeOf(el: Element, depth: number): Json {
  const out: Json = { tag: el.tagName.toLowerCase() };
  const cls = el.getAttribute('class');
  if (cls) out.class = cls;
  const role = el.getAttribute('role');
  if (role) out.role = role;
  const aria: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (a.name.startsWith('aria-')) aria[a.name] = maskStr(a.value);
  if (Object.keys(aria).length > 0) out.aria = aria;
  // input은 type/name만 기록한다. value는 수집하지 않는다.
  if (el.tagName === 'INPUT') {
    out.type = el.getAttribute('type');
    out.name = el.getAttribute('name');
  }
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
    const text = ownText(el);
    if (text) out.text = text;
  }
  if (depth > 0) {
    const kids = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName));
    if (kids.length > 0) {
      out.children = kids.slice(0, MAX_CHILDREN).map((c) => subtreeOf(c, depth - 1));
      if (kids.length > MAX_CHILDREN) out.childrenOmitted = kids.length - MAX_CHILDREN;
    }
  }
  return out;
}

function ancestorsOf(el: Element): Json[] {
  const out: Json[] = [];
  let cur = el.parentElement;
  while (cur) {
    out.push({
      tag: cur.tagName.toLowerCase(),
      id: cur.id || null,
      class: cur.getAttribute('class'),
      role: cur.getAttribute('role'),
      ariaLabel: cur.getAttribute('aria-label') === null ? null : maskStr(cur.getAttribute('aria-label')!),
    });
    if (cur.tagName === 'BODY') break;
    cur = cur.parentElement;
  }
  return out;
}

function inspectRaw(selectors: string[], opts?: InspectOpts): { results: Json[]; invalid: string[] } {
  const depth = Math.max(0, opts?.depth ?? 4);
  const maxMatches = Math.max(1, opts?.maxMatches ?? 20);
  const results: Json[] = [];
  const invalid: string[] = [];
  for (const selector of selectors) {
    let list: Element[];
    try {
      list = Array.from(document.querySelectorAll(selector)).slice(0, maxMatches);
    } catch {
      invalid.push(selector);
      continue;
    }
    for (const el of list) {
      results.push({ selector, cssPath: cssPath(el), ancestors: ancestorsOf(el), subtree: subtreeOf(el, depth) });
    }
  }
  return { results, invalid };
}

function inspect(selectors: string[], opts?: InspectOpts): Json {
  const { results, invalid } = inspectRaw(selectors, opts);
  return maskDeep({
    url: location.href,
    isTop: window === window.top,
    ts: new Date().toISOString(),
    selectors,
    invalid,
    results,
  });
}

// ---------- recording ----------
interface Recording {
  startedAt: number;
  mutations: Json[];
  resources: Json[];
  events: Json[];
  watches: Json[];
  truncated: { mutations: boolean; events: boolean; resources: boolean; watches: boolean };
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

function startRecording(recOpts?: RecordingOpts): Json {
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

  // URL 변화: hashchange와 location.href 폴링으로 기록한다(SPA의 pushState 포함).
  let lastHref = location.href;
  const checkHref = (type: string) => {
    if (location.href === lastHref) return;
    pushEvent({ t: now(), type, from: lastHref, to: location.href });
    lastHref = location.href;
  };
  on('hashchange', () => checkHref('hashchange'));
  on('popstate', () => checkHref('popstate'));
  const hrefTimer = setInterval(() => checkHref('urlchange'), 500);
  stopListeners.push(() => clearInterval(hrefTimer));

  // watch: 간격마다 inspect 결과를 기록한다. 직전과 같으면 생략, 상한 MAX_WATCHES회.
  const watches: Json[] = [];
  const truncated = { mutations: false, events: false, resources: false, watches: false };
  const watch = recOpts?.watch;
  if (watch && watch.selectors.length > 0) {
    let lastKey = '';
    const tick = () => {
      const { results } = inspectRaw(watch.selectors);
      const key = JSON.stringify(results);
      if (key === lastKey) return;
      if (watches.length >= MAX_WATCHES) {
        truncated.watches = true;
        return;
      }
      lastKey = key;
      watches.push({ t: now(), results });
    };
    tick();
    const watchTimer = setInterval(tick, Math.max(100, watch.intervalMs ?? 500));
    stopListeners.push(() => clearInterval(watchTimer));
  }

  rec = { startedAt, mutations, resources, events, watches, truncated, mo, po, stopListeners };
  return { ok: true, startedAt };
}

function stopRecording(): Json {
  if (!rec) return maskDeep({ url: location.href, recording: false, mutations: [], resources: [], events: [], watches: [] });
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
    watches: r.watches,
  });
}

function status(): Json {
  return rec
    ? { recording: true, startedAt: rec.startedAt, events: rec.events.length, mutations: rec.mutations.length, resources: rec.resources.length }
    : { recording: false, events: 0, mutations: 0, resources: 0 };
}

export default defineUnlistedScript(() => {
  if (window.__bidMateProbe) return; // 중복 주입 시 기존 인스턴스 유지
  window.__bidMateProbe = { snapshot, inspect, startRecording, stopRecording, status };
});
