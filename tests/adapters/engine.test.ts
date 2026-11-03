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
    const v1 = SELECTOR_SETS['naverworks-v1']!;
    const empty: ComposeSelectorSet = {
      ...v1, status: 'unverified', compose: { readySelector: '' },
      to: { input: '', chip: '', chipEmail: '', commit: [] }, cc: { input: '', chip: '', chipEmail: '', commit: [] },
      subject: { input: '' }, body: { kind: 'contenteditable', editable: '', insert: [] },
      attach: { fileInput: '', item: '', itemName: '', methods: [] },
    };
    const a = new GenericComposeAdapter(empty, document, TIMING);
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

describe('naverworks-v1 iframe 본문과 서명 유지', () => {
  const V1 = SELECTOR_SETS['naverworks-v1']!;
  const SIGN = '<div data-workseditor="sign-content"><table><tbody><tr><td>서명 홍길동</td></tr></tbody></table></div>';
  const setup = (insert: Array<'execCommand' | 'paste' | 'innerHTML'> = ['innerHTML'], sign = true) => {
    document.body.innerHTML = '<div id="cont_flex_area"><input name="subject"><iframe></iframe></div>';
    const idoc = document.querySelector('iframe')!.contentDocument!;
    idoc.body.innerHTML = `<div class="workseditor-content" contenteditable="true"><div>옛 내용</div>${sign ? SIGN : ''}</div>`;
    const set: ComposeSelectorSet = { ...V1, body: { ...V1.body, insert } };
    return { idoc, a: new GenericComposeAdapter(set, document, TIMING), ed: idoc.querySelector<HTMLElement>('.workseditor-content')! };
  };

  it('setBody: ok, rendered에 서명 텍스트 없음, 서명 유지', async () => {
    const { a, ed } = setup();
    const r = await a.setBody('<p>새 본문</p>');
    expect(r.status).toBe('ok');
    expect(r.rendered).toBe('새 본문');
    expect(r.rendered).not.toContain('서명');
    expect(ed.querySelector('[data-workseditor="sign-content"]')?.textContent).toContain('서명 홍길동');
    expect(ed.textContent).not.toContain('옛 내용');
  });
  it('삽입 중 서명이 사라지면 insertHtml이 되돌리고 모든 전략 실패로 INSERT_FAILED, 서명은 복원', async () => {
    const { a, ed } = setup();
    ed.addEventListener('input', () => ed.querySelector('[data-workseditor="sign-content"]')?.remove());
    const r = await a.setBody('<p>새 본문</p>');
    expect(r.status).toBe('failed');
    expect(r.error).toBe('INSERT_FAILED');
    expect(ed.querySelector('[data-workseditor="sign-content"]')?.textContent).toContain('서명 홍길동');
  });
  it('삽입 직후 settle 동안 서명이 사라지면 mismatch/KEEP_LOST', async () => {
    const { a, ed } = setup();
    setTimeout(() => ed.querySelector('[data-workseditor="sign-content"]')?.remove(), 0);
    const r = await a.setBody('<p>새 본문</p>');
    expect(r.status).toBe('mismatch');
    expect(r.error).toBe('KEEP_LOST');
  });
  it('readState: bodyText/bodyHtml에 서명이 없다', async () => {
    const { a } = setup();
    await a.setBody('<p>새 본문</p>');
    const st = a.readState();
    expect(st.bodyText).toBe('새 본문');
    expect(st.bodyText).not.toContain('서명');
    expect(st.bodyHtml).not.toContain('서명');
    expect(st.bodyHtml).not.toContain('<table');
    expect(st.bodyHtml).toContain('새 본문');
  });
  it('서명이 처음부터 없으면 KEEP_LOST가 아니다', async () => {
    const { a } = setup(['innerHTML'], false);
    const r = await a.setBody('<p>새 본문</p>');
    expect(r.status).toBe('ok');
    expect(r.error).toBeUndefined();
  });
  it('detect: to.input이 비어도 제목과 iframe 본문이 있으면 ready', () => {
    const { a } = setup();
    expect(V1.to.input).toBe('');
    expect(a.detect()).toMatchObject({ isCompose: true, ready: true });
  });
  it('detect: iframe 본문이 없으면 ready 아님', () => {
    const { a, idoc } = setup();
    idoc.body.innerHTML = '';
    expect(a.detect()).toMatchObject({ isCompose: true, ready: false, reason: 'FIELDS_NOT_FOUND' });
  });
});

describe('naverworks-v1 iframe 안 첨부 목록(inBodyFrame)', () => {
  const V1 = SELECTOR_SETS['naverworks-v1']!;
  const LIST = '<ul class="attachment_list"></ul>';
  const rowHtml = (name: string, ext: string) =>
    `<button class="btn_attachment_remove">x</button><span class="lw_file lw_file_png"></span><span class="file_name_cover"><span class="file_name">${name}</span><span class="file_extension">${ext}</span></span><span class="file_status">대기 중</span><span class="file_size">17.2  MB</span>`;
  const setup = (opts: { listIn: 'frame' | 'outer'; split?: [string, string] }) => {
    document.body.innerHTML = `<div id="cont_flex_area"><input name="subject"><iframe></iframe></div><input type="file" id="fileContent">${opts.listIn === 'outer' ? LIST : ''}`;
    const idoc = document.querySelector('iframe')!.contentDocument!;
    idoc.body.innerHTML = `<div class="workseditor-content" contenteditable="true"><div>x</div></div>${opts.listIn === 'frame' ? LIST : ''}`;
    const listDoc = opts.listIn === 'frame' ? idoc : document;
    document.getElementById('fileContent')!.addEventListener('change', (e) => {
      const f = (e.target as unknown as { files: File[] }).files[0]!;
      const li = listDoc.createElement('li');
      li.className = 'attachment_item';
      const [n, ext] = opts.split ?? [f.name, ''];
      li.innerHTML = rowHtml(n, ext);
      listDoc.querySelector('ul')!.appendChild(li);
    });
    return { idoc, a: new GenericComposeAdapter(V1, document, TIMING) };
  };
  const sig = () => ({ signal: new AbortController().signal, onPhase: () => {} });

  it('iframe 목록에 나타나면 uploaded(input), renderedName은 file_name_cover 텍스트', async () => {
    const { a } = setup({ listIn: 'frame', split: ['erd-full', 'png'] });
    const r = await a.attachFile(new File(['x'], 'erd-full.png'), sig());
    expect(r.status).toBe('uploaded');
    expect(r.method).toBe('input');
    expect(r.renderedName).toBe('erd-fullpng');
    expect(r.renderedSize).toBe('17.2  MB');
  });
  it('이름 "보고서.pdf"가 화면에서 "보고서"+"pdf"로 나뉘어도 매칭', async () => {
    const { a } = setup({ listIn: 'frame', split: ['보고서', 'pdf'] });
    const r = await a.attachFile(new File(['x'], '보고서.pdf'), sig());
    expect(r.status).toBe('uploaded');
  });
  it('목록이 바깥 문서에만 있으면 찾지 못한다(readState에도 안 잡힘)', async () => {
    const { a } = setup({ listIn: 'outer' });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const r = await a.attachFile(new File(['x'], 'a.png'), { signal: ac.signal, onPhase: () => {} });
    expect(r.status).not.toBe('uploaded');
    expect(document.querySelectorAll('li.attachment_item').length).toBe(1);
    expect(a.readState().attachments).toEqual([]);
  });
  it('readState().attachments가 iframe 목록을 읽는다', async () => {
    const { a, idoc } = setup({ listIn: 'frame' });
    const li = idoc.createElement('li');
    li.className = 'attachment_item';
    li.innerHTML = rowHtml('a', 'png');
    idoc.querySelector('ul')!.appendChild(li);
    const st = a.readState();
    expect(st.attachments).toHaveLength(1);
    expect(st.attachments[0]).toMatchObject({ name: 'apng' });
    expect(st.supported.attachments).toBe(true);
  });
});

describe('naverworks-v1 첨부 이름 대조(정확 일치, 기존 항목 제외)', () => {
  const V1 = SELECTOR_SETS['naverworks-v1']!;
  const row = (name: string, ext: string) =>
    `<span class="file_name_cover"><span class="file_name">${name}</span><span class="file_extension">${ext}</span></span><span class="file_size">1 KB</span>`;
  /** existing: 미리 있는 항목[이름, 확장자]. added: 파일 주입 시 추가할 항목(없으면 추가 안 함). */
  const setup = (existing: Array<[string, string]>, added: [string, string] | null) => {
    document.body.innerHTML = '<div id="cont_flex_area"><input name="subject"><iframe></iframe></div><input type="file" id="fileContent">';
    const idoc = document.querySelector('iframe')!.contentDocument!;
    idoc.body.innerHTML = '<div class="workseditor-content" contenteditable="true"><div>x</div></div><ul class="attachment_list"></ul>';
    const add = (n: string, e: string) => {
      const li = idoc.createElement('li');
      li.className = 'attachment_item';
      li.innerHTML = row(n, e);
      idoc.querySelector('ul')!.appendChild(li);
    };
    for (const [n, e] of existing) add(n, e);
    document.getElementById('fileContent')!.addEventListener('change', () => { if (added) add(...added); });
    return new GenericComposeAdapter(V1, document, { ...TIMING, itemAppearMs: 150 });
  };
  const run = (a: GenericComposeAdapter, name: string, abortMs?: number) => {
    const ac = new AbortController();
    if (abortMs) setTimeout(() => ac.abort(), abortMs);
    return a.attachFile(new File(['x'], name), { signal: ac.signal, onPhase: () => {} });
  };

  it('"입찰공고서.hwp"가 있어도 "공고서.hwp"는 새 항목이 안 나타나면 uploaded가 아니다', async () => {
    const a = setup([['입찰공고서', 'hwp']], null);
    const r = await run(a, '공고서.hwp', 400);
    expect(r.status).not.toBe('uploaded');
  });
  it('"공고서.hwp" 주입 후 새 항목이 나타나면 그 항목으로 uploaded', async () => {
    const a = setup([['입찰공고서', 'hwp']], ['공고서', 'hwp']);
    const r = await run(a, '공고서.hwp');
    expect(r.status).toBe('uploaded');
    expect(r.renderedName).toBe('공고서hwp');
  });
  it('같은 이름이 이미 있으면 기존 항목은 무시하고 새 li가 있어야 uploaded', async () => {
    const none = await run(setup([['보고서', 'pdf']], null), '보고서.pdf', 400);
    expect(none.status).not.toBe('uploaded');
    const a = setup([['보고서', 'pdf']], ['보고서', 'pdf']);
    const r = await run(a, '보고서.pdf');
    expect(r.status).toBe('uploaded');
    expect(document.querySelector('iframe')!.contentDocument!.querySelectorAll('li.attachment_item')).toHaveLength(2);
  });
  it('"a.b.pdf"는 화면 "a.b"+"pdf"와 매칭, "ab.pdf"와는 불일치', async () => {
    expect((await run(setup([], ['a.b', 'pdf']), 'a.b.pdf')).status).toBe('uploaded');
    expect((await run(setup([], ['ab', 'pdf']), 'a.b.pdf', 400)).status).not.toBe('uploaded');
  });
  it('화면이 "보고서.pdf" 전체로 표시돼도 매칭', async () => {
    const r = await run(setup([], ['보고서.pdf', '']), '보고서.pdf');
    expect(r.status).toBe('uploaded');
  });
});

// ---------- Gmail 형태: itemLabelAttr/itemDone/convertedMarker ----------
describe('GenericComposeAdapter Gmail 형태 첨부(itemLabelAttr, itemDone, convertedMarker)', () => {
  const GM: ComposeSelectorSet = {
    ...SCOPED,
    compose: { readySelector: '', scope: 'div[role="region"]' },
    subject: { input: 'input[name="subjectbox"]' },
    attach: {
      fileInput: 'input[type=file]', item: '.dL', itemName: '.vI',
      itemLabelAttr: 'aria-label', itemDone: 'input[type=hidden][name=attach]',
      convertedMarker: 'div.gmail_chip.gmail_drive_chip', methods: ['input'],
    },
  };
  const GM_HTML = '<div role="region"><input name="subjectbox" value="s"><input type="file"></div>';
  const scope = (): Element => document.querySelector('div[role="region"]')!;
  const label = (n: string): string => `첨부파일 업로드 중: ${n}. 취소하려면 Enter 키를 누르세요`;
  const onChange = (fn: (name: string) => void): void => {
    scope().querySelector('input[type=file]')!.addEventListener('change', (e) => {
      fn((e.target as unknown as { files: File[] }).files[0]!.name);
    });
  };
  const mk = (set: ComposeSelectorSet = GM, timing = {}): GenericComposeAdapter =>
    new GenericComposeAdapter(set, document, { ...TIMING, ...timing });
  const addItem = (html: string, aria?: string): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'dL';
    if (aria !== undefined) d.setAttribute('aria-label', aria);
    d.innerHTML = html;
    scope().appendChild(d);
    return d;
  };
  beforeEach(() => {
    document.body.innerHTML = GM_HTML;
    (globalThis as Record<string, unknown>).DataTransfer = class {
      files: File[] = [];
      items = { add: (f: File) => { this.files.push(f); } };
    };
  });

  it('itemLabelAttr: aria-label에 파일 이름이 들어 있으면 항목을 찾아 uploaded', async () => {
    onChange((n) => { addItem(`<span class="vI">${n} (2,791K)</span><input type="hidden" name="attach">`, label(n)); });
    const r = await mk().attachFile(new File(['x'], '보고서.pdf'), sig());
    expect(r.status).toBe('uploaded');
  });

  it('itemLabelAttr 폴백: aria-label이 없으면 itemName 텍스트 완전 일치로 찾는다', async () => {
    onChange((n) => { addItem(`<span class="vI">${n}</span><input type="hidden" name="attach">`); });
    const r = await mk().attachFile(new File(['x'], 'a.pdf'), sig());
    expect(r.status).toBe('uploaded');
  });

  it('업로드 중(.vI 없음, aria-label에 이름만)이 itemAppearMs보다 길어도 재주입하지 않는다', async () => {
    let injects = 0;
    onChange((n) => {
      injects++;
      const it = addItem('', label(n));
      setTimeout(() => it.insertAdjacentHTML('beforeend', '<input type="hidden" name="attach">'), 300);
    });
    const set = { ...GM, attach: { ...GM.attach, methods: ['input', 'input'] as Array<'input'> } };
    const r = await mk(set, { itemAppearMs: 100 }).attachFile(new File(['x'], 'b.pdf'), sig());
    expect(injects).toBe(1);
    expect(r.error).not.toBe('NO_INJECTION_PATH');
    expect(r.status).toBe('uploaded');
  });

  it('itemDone: 완료 요소가 없으면 uploaded가 아니고, 생긴 뒤 stableMs가 지나면 uploaded', async () => {
    let it: HTMLElement | null = null;
    let doneAt = 0;
    onChange((n) => {
      it = addItem(`<span class="vI">${n}</span>`, label(n));
      setTimeout(() => { it!.insertAdjacentHTML('beforeend', '<input type="hidden" name="attach">'); doneAt = Date.now(); }, 200);
    });
    const r = await mk().attachFile(new File(['x'], 'c.pdf'), sig());
    expect(doneAt).toBeGreaterThan(0);
    expect(r.status).toBe('uploaded');
    expect(Date.now() - doneAt).toBeGreaterThanOrEqual(0);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(200 + TIMING.stableMs - 5);
  });

  it('convertedMarker: 주입 뒤 marker가 새로 생기면 failed DRIVE_CONVERTED', async () => {
    onChange(() => { scope().insertAdjacentHTML('beforeend', '<div class="gmail_chip gmail_drive_chip"></div>'); });
    const r = await mk().attachFile(new File(['x'], 'd.pdf'), sig());
    expect(r.status).toBe('failed');
    expect(r.error).toBe('DRIVE_CONVERTED');
  });

  it('convertedMarker: 주입 전부터 있던 marker가 늘지 않으면 DRIVE_CONVERTED가 아니다', async () => {
    scope().insertAdjacentHTML('beforeend', '<div class="gmail_chip gmail_drive_chip"></div>');
    onChange((n) => { addItem(`<span class="vI">${n}</span><input type="hidden" name="attach">`, label(n)); });
    const r = await mk().attachFile(new File(['x'], 'e.pdf'), sig());
    expect(r.error).not.toBe('DRIVE_CONVERTED');
    expect(r.status).toBe('uploaded');
  });

  it('convertedMarker와 blockingDialog가 동시에 성립하면 DRIVE_CONVERTED가 우선', async () => {
    onChange(() => {
      scope().insertAdjacentHTML('beforeend', '<div class="gmail_chip gmail_drive_chip"></div>');
      document.body.insertAdjacentHTML('beforeend', '<div id="dlg"></div>');
    });
    const set = { ...GM, attach: { ...GM.attach, blockingDialog: '#dlg' } };
    const r = await mk(set).attachFile(new File(['x'], 'f.pdf'), sig());
    expect(r.status).toBe('failed');
    expect(r.error).toBe('DRIVE_CONVERTED');
  });

  it('앞뒤 경계: aria-label이 aa.pdf인 항목은 a.pdf로 잡지 않는다', async () => {
    onChange(() => { addItem('<input type="hidden" name="attach">', '첨부파일: aa.pdf. 파일을 보려면 Enter 키를 누르세요'); });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const r = await mk().attachFile(new File(['x'], 'a.pdf'), { signal: ac.signal, onPhase: () => {} });
    expect(r.status).not.toBe('uploaded');
  });

  it('앞뒤 경계: 첨부파일(보고서.pdf)을 저장 중입니다 형태도 보고서.pdf로 찾는다', async () => {
    onChange(() => { addItem('<input type="hidden" name="attach">', '첨부파일(보고서.pdf)을 저장 중입니다.'); });
    const r = await mk().attachFile(new File(['x'], '보고서.pdf'), sig());
    expect(r.status).toBe('uploaded');
  });
});
