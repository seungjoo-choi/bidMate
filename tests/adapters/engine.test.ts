// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GenericComposeAdapter } from '../../src/adapters/naverworks/engine';
import { SELECTOR_SETS } from '../../src/adapters/naverworks/selectors';
import type { ComposeSelectorSet } from '../../src/adapters/naverworks/types';

// 테스트 전용 셀렉터셋. 실제 네이버웍스 값이 아니다.
const FIX: ComposeSelectorSet = {
  id: 'fixture', version: 'test', status: 'verified', hostPattern: 'localhost',
  compose: { readySelector: '#compose' },
  to: { input: '#to-in', chip: '#to-chips .chip', chipEmail: '.em', commit: ['enter'] },
  cc: { input: '#cc-in', chip: '#cc-chips .chip', chipEmail: '.em', commit: ['enter'] },
  subject: { input: '#subject' },
  body: { kind: 'contenteditable', editable: '#body', insert: ['execCommand', 'paste', 'innerHTML'] },
  attach: { fileInput: '#file', item: '.att', itemName: '.nm', itemSize: '.sz', itemProgress: '.prog', methods: ['input'] },
  forbidden: { send: ['#send'], textPatterns: ['보내기'] },
};
const TIMING = { settleMs: 1, stableMs: 30, pollMs: 5 };

const HTML = `
<div id="compose">
  <input id="to-in"><div id="to-chips"></div>
  <input id="cc-in"><div id="cc-chips"></div>
  <input id="subject">
  <div id="body" contenteditable="true"></div>
  <input type="file" id="file">
  <div id="atts"></div>
  <button id="send">보내기</button>
</div>`;

function wireChips(inId: string, chipsId: string): void {
  const input = document.getElementById(inId) as HTMLInputElement;
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Enter' || !input.value) return;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<b class="em">${input.value}</b>`;
    document.getElementById(chipsId)!.appendChild(chip);
    input.value = '';
  });
}

beforeEach(() => {
  document.body.innerHTML = HTML;
  wireChips('to-in', 'to-chips');
  wireChips('cc-in', 'cc-chips');
  // jsdom에는 DataTransfer가 없어 최소 대체물을 둔다.
  (globalThis as Record<string, unknown>).DataTransfer = class {
    files: File[] = [];
    items = { add: (f: File) => { this.files.push(f); } };
  };
  (document.getElementById('file') as HTMLInputElement).addEventListener('change', (e) => {
    const f = (e.target as unknown as { files: File[] }).files[0]!;
    const row = document.createElement('div');
    row.className = 'att';
    row.innerHTML = `<span class="nm">${f.name}</span><span class="sz">${f.size}B</span><i class="prog"></i>`;
    document.getElementById('atts')!.appendChild(row);
    setTimeout(() => row.querySelector('.prog')?.remove(), 20);
  });
});
afterEach(() => { delete (globalThis as Record<string, unknown>).DataTransfer; });

describe('GenericComposeAdapter', () => {
  it('빈 셀렉터 필드는 unsupported(SELECTOR_MISSING)', async () => {
    const a = new GenericComposeAdapter(SELECTOR_SETS['naverworks-v1']!, document, TIMING);
    for (const r of [await a.setRecipients('to', ['a@b.com']), await a.setRecipients('cc', []), await a.setSubject('x'), await a.setBody('<p>x</p>')]) {
      expect(r.status).toBe('unsupported');
      expect(r.error).toBe('SELECTOR_MISSING');
    }
    const f = new File(['x'], 'a.txt');
    const att = await a.attachFile(f, { signal: new AbortController().signal, onPhase: () => {} });
    expect(att.status).toBe('skipped');
    expect(a.detect()).toMatchObject({ isCompose: false, ready: false });
  });

  it('fixture: 수신자, 제목, 본문을 입력하고 readState로 읽는다', async () => {
    const a = new GenericComposeAdapter(FIX, document, TIMING);
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
    const to = await a.setRecipients('to', ['A@x.com', 'b@x.com']);
    expect(to.status).toBe('ok');
    expect(to.rendered).toEqual(['a@x.com', 'b@x.com']);
    expect((await a.setRecipients('cc', ['c@x.com'])).status).toBe('ok');
    expect((await a.setSubject('안녕')).status).toBe('ok');
    const body = await a.setBody('<p>본문 <b>내용</b></p>');
    expect(body.status).toBe('ok');
    expect(body.method).toBe('innerHTML');
    const st = a.readState();
    expect(st.to).toEqual(['a@x.com', 'b@x.com']);
    expect(st.cc).toEqual(['c@x.com']);
    expect(st.subject).toBe('안녕');
    expect(st.bodyText).toBe('본문 내용');
    expect(st.bodyHtml).toContain('<b>내용</b>');
  });

  it('fixture: 요청과 칩 집합이 다르면 mismatch', async () => {
    const a = new GenericComposeAdapter({ ...FIX, to: { ...FIX.to, commit: ['tab'] } }, document, TIMING);
    const r = await a.setRecipients('to', ['a@x.com']);
    expect(r.status).toBe('mismatch');
  });

  it('fixture: input 경로로 첨부하고 업로드 완료를 판정한다', async () => {
    const a = new GenericComposeAdapter(FIX, document, TIMING);
    const phases: string[] = [];
    const r = await a.attachFile(new File(['hello'], 'doc.txt'), { signal: new AbortController().signal, onPhase: (p) => phases.push(p) });
    expect(r.status).toBe('uploaded');
    expect(r.method).toBe('input');
    expect(r.renderedName).toBe('doc.txt');
    expect(phases).toEqual(['injecting', 'uploading']);
    expect(a.readState().attachments).toEqual([{ name: 'doc.txt', size: '5B', uploading: false }]);
  });

  it('fixture: item이 늦게 떠도 주입은 1회만 일어난다', async () => {
    const input = document.getElementById('file') as HTMLInputElement;
    // 기본 리스너가 만든 item 대신 지연 생성 리스너로 교체한다.
    const fresh = input.cloneNode(true) as HTMLInputElement;
    input.replaceWith(fresh);
    let injects = 0;
    fresh.addEventListener('change', (e) => {
      injects++;
      const f = (e.target as unknown as { files: File[] }).files[0]!;
      setTimeout(() => {
        const row = document.createElement('div');
        row.className = 'att';
        row.innerHTML = `<span class="nm">${f.name}</span><span class="sz">1B</span>`;
        document.getElementById('atts')!.appendChild(row);
      }, 300);
    });
    const a = new GenericComposeAdapter({ ...FIX, attach: { ...FIX.attach, methods: ['input', 'input'] } }, document, { ...TIMING, itemAppearMs: 2000 });
    const r = await a.attachFile(new File(['x'], 'late.txt'), { signal: new AbortController().signal, onPhase: () => {} });
    expect(r.status).toBe('uploaded');
    expect(injects).toBe(1);
  });
});

// ---------- scope 범위 ----------
const SCOPED: ComposeSelectorSet = {
  ...FIX,
  compose: { readySelector: '', scope: '.win' },
  to: { ...FIX.to, input: '.to-in', chip: '.to-chips .chip' },
  cc: { ...FIX.cc, input: '.cc-in', chip: '.cc-chips .chip' },
  subject: { input: '.subj' },
  body: { kind: 'contenteditable', editable: '.bd', insert: ['innerHTML'] },
  attach: { fileInput: '.file', dropZone: '.zone', item: '.att', itemName: '.nm', itemProgress: '.prog', methods: ['input'] },
};
const win = (subject: string, extra = ''): string =>
  `<div class="win"><input class="to-in"><div class="to-chips"></div><input class="cc-in"><div class="cc-chips"></div>`
  + `<input class="subj" value="${subject}"><div class="bd" contenteditable="true"></div><input type="file" class="file"><div class="zone"></div>${extra}</div>`;
const sig = () => ({ signal: new AbortController().signal, onPhase: () => {} });

describe('GenericComposeAdapter scope', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).DataTransfer = class {
      files: File[] = [];
      items = { add: (f: File) => { this.files.push(f); } };
    };
  });

  it('scope 2개 중 subject 일치 1개를 선택한다', () => {
    document.body.innerHTML = win('A') + win('B');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'B' });
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
    expect(a.resolveScope().el).toBe(document.querySelectorAll('.win')[1]);
  });

  it('subject 비교는 공백을 정규화한다', () => {
    document.body.innerHTML = win('가  나') + win('다');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: ' 가 나 ' });
    expect(a.resolveScope().el).toBe(document.querySelectorAll('.win')[0]);
  });

  it('둘 다 일치하면 SCOPE_AMBIGUOUS, ready false', () => {
    document.body.innerHTML = win('A') + win('A');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    expect(a.resolveScope()).toEqual({ el: null, reason: 'SCOPE_AMBIGUOUS' });
    expect(a.detect()).toMatchObject({ isCompose: true, ready: false, reason: 'SCOPE_AMBIGUOUS' });
  });

  it('anchor 없음 + 후보 1개면 선택한다', () => {
    document.body.innerHTML = win('A');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING);
    expect(a.resolveScope().el).toBe(document.querySelector('.win'));
    expect(a.detect().ready).toBe(true);
  });

  it('anchor 없음 + 후보 2개면 SCOPE_AMBIGUOUS', () => {
    document.body.innerHTML = win('A') + win('B');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: '' });
    expect(a.resolveScope().reason).toBe('SCOPE_AMBIGUOUS');
    expect(a.detect().ready).toBe(false);
  });

  it('후보 0개면 SCOPE_NOT_FOUND', () => {
    document.body.innerHTML = '<div></div>';
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    expect(a.resolveScope()).toEqual({ el: null, reason: 'SCOPE_NOT_FOUND' });
    expect(a.detect()).toMatchObject({ isCompose: false, ready: false, reason: 'SCOPE_NOT_FOUND' });
  });

  it('pin 후 요소가 제거되면 SCOPE_LOST(첨부 failed, readState 빈 상태)', async () => {
    document.body.innerHTML = win('A');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    expect(a.detect().ready).toBe(true);
    document.querySelector('.win')!.remove();
    const r = await a.attachFile(new File(['x'], 'a.txt'), sig());
    expect(r.status).toBe('failed');
    expect(r.error).toBe('SCOPE_LOST');
    const st = a.readState();
    expect(st.subject).toBe('');
    expect(st.supported).toEqual({ to: false, cc: false, subject: false, body: false, attachments: false });
  });

  it('pendingSelector가 scope 안에 있으면 uploaded 미판정, 다른 scope에 있으면 무관', async () => {
    document.body.innerHTML = win('A', '<div class="att"><span class="nm">p.txt</span></div>') + win('B', '<i class="pend"></i>');
    const set = { ...SCOPED, attach: { ...SCOPED.attach, pendingSelector: '.pend' } };
    const a = new GenericComposeAdapter(set, document, TIMING, { subject: 'A' });
    expect(a.readState().attachments).toEqual([{ name: 'p.txt', uploading: false }]);
    document.querySelectorAll('.win')[0]!.insertAdjacentHTML('beforeend', '<i class="pend"></i>');
    expect(a.readState().attachments).toEqual([{ name: 'p.txt', uploading: true }]);
  });

  it('blockingDialog가 등장하면 failed DIALOG_SHOWN', async () => {
    document.body.innerHTML = win('A');
    const input = document.querySelector('.file') as HTMLInputElement;
    input.addEventListener('change', () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="dlg"></div>');
    });
    const set = { ...SCOPED, attach: { ...SCOPED.attach, blockingDialog: '#dlg' } };
    const a = new GenericComposeAdapter(set, document, TIMING, { subject: 'A' });
    const r = await a.attachFile(new File(['x'], 'a.txt'), sig());
    expect(r.status).toBe('failed');
    expect(r.error).toBe('DIALOG_SHOWN');
  });

  it("dropZone ':scope'면 scope 요소가 드롭 대상", async () => {
    document.body.innerHTML = win('A') + win('B');
    const wins = document.querySelectorAll('.win');
    let dropped: Element | null = null;
    const ac = new AbortController();
    (globalThis as Record<string, unknown>).DragEvent = class extends Event {
      constructor(type: string, init?: EventInit) { super(type, init); }
    };
    wins[1]!.addEventListener('drop', (e) => { dropped = e.currentTarget as Element; ac.abort(); });
    const set = { ...SCOPED, attach: { ...SCOPED.attach, dropZone: ':scope', methods: ['drop' as const] } };
    const a = new GenericComposeAdapter(set, document, { ...TIMING, itemAppearMs: 30 }, { subject: 'B' });
    await a.attachFile(new File(['x'], 'a.txt'), { signal: ac.signal, onPhase: () => {} });
    expect(dropped).toBe(wins[1]);
  });

  it('to.input이 비어도 subject와 body가 있으면 ready', () => {
    document.body.innerHTML = win('A');
    const set = { ...SCOPED, to: { ...SCOPED.to, input: '' } };
    const a = new GenericComposeAdapter(set, document, TIMING);
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
    const none = new GenericComposeAdapter({ ...set, subject: { input: '' }, body: { ...set.body, editable: '' } }, document, TIMING);
    expect(none.detect()).toMatchObject({ ready: false, reason: 'SELECTOR_MISSING' });
  });

  it('readState의 supported 플래그', () => {
    document.body.innerHTML = win('A');
    const set = { ...SCOPED, cc: { ...SCOPED.cc, input: '', chip: '' }, attach: { ...SCOPED.attach, item: '' } };
    const st = new GenericComposeAdapter(set, document, TIMING).readState();
    expect(st.supported).toEqual({ to: true, cc: false, subject: true, body: true, attachments: false });
  });

  it('scope 미설정이면 문서 전체 첫 요소를 쓴다(현행)', () => {
    document.body.innerHTML = HTML + HTML;
    const a = new GenericComposeAdapter(FIX, document, TIMING);
    expect(a.resolveScope().el).toBe(document);
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
    expect(a.readState().supported.attachments).toBe(true);
  });
});

describe('GenericComposeAdapter scope 본문과 재해석', () => {
  const winB = (subject: string, bodyText: string): string =>
    `<div class="win"><input class="to-in"><div class="to-chips"></div><input class="cc-in"><div class="cc-chips"></div>`
    + `<input class="subj" value="${subject}"><div class="bd" contenteditable="true">${bodyText}</div><input type="file" class="file"><div class="zone"></div></div>`;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).DataTransfer = class {
      files: File[] = [];
      items = { add: (f: File) => { this.files.push(f); } };
    };
  });

  it('창 2개에서 anchor A면 detect, readState, setBody가 A 본문만 읽고 쓴다', async () => {
    document.body.innerHTML = winB('B', 'bbb') + winB('A', 'aaa');
    const bodies = document.querySelectorAll('.bd');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
    expect(a.readState().bodyText).toBe('aaa');
    const r = await a.setBody('<p>new</p>');
    expect(r.status).toBe('ok');
    expect(bodies[1]!.textContent).toBe('new');
    expect(bodies[0]!.textContent).toBe('bbb');
  });

  it('첨부 paste 대상은 A 창 본문이다', async () => {
    document.body.innerHTML = winB('B', '') + winB('A', '');
    const bodies = document.querySelectorAll('.bd');
    const ac = new AbortController();
    const hit: Element[] = [];
    (globalThis as Record<string, unknown>).ClipboardEvent = class extends Event {
      constructor(type: string, init?: EventInit) { super(type, init); }
    };
    bodies.forEach((b) => b.addEventListener('paste', (e) => { hit.push(e.currentTarget as Element); ac.abort(); }));
    const set = { ...SCOPED, attach: { ...SCOPED.attach, dropZone: '', methods: ['paste' as const] } };
    const a = new GenericComposeAdapter(set, document, { ...TIMING, itemAppearMs: 30 }, { subject: 'A' });
    await a.attachFile(new File(['x'], 'a.txt'), { signal: ac.signal, onPhase: () => {} });
    expect(hit).toEqual([bodies[1]]);
  });

  it('첨부 drop 대상은 A 창 zone이다', async () => {
    document.body.innerHTML = winB('B', '') + winB('A', '');
    const zones = document.querySelectorAll('.zone');
    const ac = new AbortController();
    const hit: Element[] = [];
    (globalThis as Record<string, unknown>).DragEvent = class extends Event {
      constructor(type: string, init?: EventInit) { super(type, init); }
    };
    zones.forEach((z) => z.addEventListener('drop', (e) => { hit.push(e.currentTarget as Element); ac.abort(); }));
    const set = { ...SCOPED, attach: { ...SCOPED.attach, methods: ['drop' as const] } };
    const a = new GenericComposeAdapter(set, document, { ...TIMING, itemAppearMs: 30 }, { subject: 'A' });
    await a.attachFile(new File(['x'], 'a.txt'), { signal: ac.signal, onPhase: () => {} });
    expect(hit).toEqual([zones[1]]);
  });

  it('scope 미해석(AMBIGUOUS)이면 setBody는 failed SCOPE_AMBIGUOUS, readState bodyText는 빈 값', async () => {
    document.body.innerHTML = winB('A', 'aaa') + winB('A', 'bbb');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    const r = await a.setBody('<p>x</p>');
    expect(r).toMatchObject({ status: 'failed', error: 'SCOPE_AMBIGUOUS' });
    expect(a.readState().bodyText).toBe('');
    expect(document.querySelectorAll('.bd')[0]!.textContent).toBe('aaa');
  });

  it('anchor 없음 + pin 후 제거, 다른 창 1개만 남아도 재선택하지 않고 SCOPE_LOST', async () => {
    document.body.innerHTML = winB('A', 'aaa') + winB('B', 'bbb');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING);
    expect(a.resolveScope().reason).toBe('SCOPE_AMBIGUOUS');
    document.querySelectorAll('.win')[1]!.remove();
    expect(a.resolveScope().el).not.toBeNull();   // 후보 1개라 pin
    document.querySelector('.win')!.remove();
    document.body.insertAdjacentHTML('beforeend', winB('C', 'ccc'));
    expect(a.resolveScope().el).toBeNull();
    const r = await a.attachFile(new File(['x'], 'a.txt'), sig());
    expect(r).toMatchObject({ status: 'failed', error: 'SCOPE_LOST' });
  });

  it('anchor 있음 + pin 제거 후 같은 제목 창이 다시 나타나면 재해석한다', () => {
    document.body.innerHTML = winB('A', 'old');
    const a = new GenericComposeAdapter(SCOPED, document, TIMING, { subject: 'A' });
    expect(a.resolveScope().el).toBe(document.querySelector('.win'));
    document.querySelector('.win')!.remove();
    document.body.innerHTML = winB('A', 'new');
    expect(a.resolveScope().el).toBe(document.querySelector('.win'));
    expect(a.readState().bodyText).toBe('new');
  });

  it('supported.to/cc는 chip 셀렉터 기준', () => {
    document.body.innerHTML = winB('A', '');
    const noChip = { ...SCOPED, to: { ...SCOPED.to, chip: '' }, cc: { ...SCOPED.cc, chip: '' } };
    expect(new GenericComposeAdapter(noChip, document, TIMING).readState().supported).toMatchObject({ to: false, cc: false });
    expect(new GenericComposeAdapter(SCOPED, document, TIMING).readState().supported).toMatchObject({ to: true, cc: true });
  });
});
