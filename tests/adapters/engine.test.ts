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
