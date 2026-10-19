// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<Record<string, unknown>> = [];
vi.mock('wxt/utils/define-unlisted-script', () => ({ defineUnlistedScript: (fn: () => void) => fn }));
vi.mock('../../src/messaging/bus', () => ({ send: vi.fn(async (_t: string, p: Record<string, unknown>) => { sent.push(p); }) }));

import { isSendButton, isSendHotkey } from '../../src/adapters/naverworks/send-watch-match';
import type { SendWatchConfig } from '../../src/adapters/naverworks/types';

const CFG: SendWatchConfig = { buttons: ['button[data-hotkey="sendKey"]'], textPatterns: ['보내기'], hotkey: true };

describe('send-watch 판정 함수', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('버튼 셀렉터에 맞으면 true, 내부 span 클릭도 closest로 맞는다', () => {
    document.body.innerHTML = '<button data-hotkey="sendKey"><span id="in">x</span></button>';
    expect(isSendButton(document.getElementById('in'), CFG)).toBe(true);
  });
  it('텍스트/aria-label 패턴에 맞으면 true, 아니면 false', () => {
    document.body.innerHTML = '<button id="a">보내기</button><div role="button" id="b" aria-label="보내기 (⌘Enter)"></div><button id="c">임시저장</button><div id="d">보내기</div>';
    const g = (id: string) => document.getElementById(id);
    expect(isSendButton(g('a'), CFG)).toBe(true);
    expect(isSendButton(g('b'), CFG)).toBe(true);
    expect(isSendButton(g('c'), CFG)).toBe(false);
    expect(isSendButton(g('d'), CFG)).toBe(false);   // 버튼 계열이 아님
  });
  it('텍스트 입력칸은 value에 패턴이 있어도 false, 버튼형 input은 true', () => {
    document.body.innerHTML = '<input id="t" type="text" value="제안서 보내기"><input id="b" type="submit" value="보내기">';
    expect(isSendButton(document.getElementById('t'), CFG)).toBe(false);
    expect(isSendButton(document.getElementById('b'), CFG)).toBe(true);
  });
  it('hotkey는 Ctrl/Cmd+Enter이고 설정이 켜진 때만', () => {
    expect(isSendHotkey({ ctrlKey: true, metaKey: false, key: 'Enter' }, CFG)).toBe(true);
    expect(isSendHotkey({ ctrlKey: false, metaKey: true, key: 'Enter' }, CFG)).toBe(true);
    expect(isSendHotkey({ ctrlKey: false, metaKey: false, key: 'Enter' }, CFG)).toBe(false);
    expect(isSendHotkey({ ctrlKey: true, metaKey: false, key: 'Enter' }, { ...CFG, hotkey: false })).toBe(false);
  });
});

describe('send-watch 스크립트', () => {
  // jsdom 합성 이벤트는 isTrusted가 항상 false이고 덮어쓸 수 없어, 등록된 캡처 리스너를 잡아 가짜 이벤트로 직접 호출한다.
  type L = (e: unknown) => void;
  let click: L; let keydown: L;
  const trusted = (o: Record<string, unknown>) => ({ isTrusted: true, ...o });

  beforeEach(async () => {
    sent.length = 0;
    document.body.innerHTML = '<button id="s" data-hotkey="sendKey">보내기</button>';
    const spy = vi.spyOn(document, 'addEventListener');
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__bidMateSendWatch;
    const mod = await import('../../src/entrypoints/send-watch');
    (mod.default as unknown as () => void)();
    click = spy.mock.calls.find((c) => c[0] === 'click')![1] as L;
    keydown = spy.mock.calls.find((c) => c[0] === 'keydown')![1] as L;
    spy.mockRestore();
    (window as unknown as { __bidMateSendWatch: { configure(c: unknown): void } }).__bidMateSendWatch.configure({ jobId: 'j1', sendWatch: CFG });
  });

  it('isTrusted가 false인 이벤트는 무시한다', () => {
    const b = document.getElementById('s')!;
    click({ isTrusted: false, target: b });
    keydown({ isTrusted: false, key: 'Enter', ctrlKey: true, metaKey: false });
    expect(sent).toEqual([]);
  });
  it('신뢰 클릭은 1회만 보고한다', () => {
    const b = document.getElementById('s')!;
    click(trusted({ target: b }));
    click(trusted({ target: b }));
    expect(sent).toEqual([{ jobId: 'j1', kind: 'click' }]);
  });
  it('신뢰 hotkey도 보고하고 이후 클릭은 무시한다', () => {
    keydown(trusted({ key: 'Enter', metaKey: true, ctrlKey: false }));
    click(trusted({ target: document.getElementById('s') }));
    expect(sent).toEqual([{ jobId: 'j1', kind: 'hotkey' }]);
  });
});
