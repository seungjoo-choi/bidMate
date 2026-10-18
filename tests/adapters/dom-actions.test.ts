// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, ForbiddenActionError, isForbidden, pressKey, setNativeValue } from '../../src/adapters/naverworks/dom-actions';
import { FileBuffer } from '../../src/adapters/naverworks/file-buffer';
import type { ComposeSelectorSet } from '../../src/adapters/naverworks/types';
import { SELECTOR_SETS } from '../../src/adapters/naverworks/selectors';

const set: ComposeSelectorSet = {
  ...SELECTOR_SETS['naverworks-v1']!,
  forbidden: { send: ['#send'], textPatterns: ['보내기', 'Send'] },
};

describe('dom-actions', () => {
  it('forbidden 요소 click을 거부한다', () => {
    document.body.innerHTML = '<button id="send">x</button><button id="t">보내기</button><button id="a" aria-label="send">i</button><form><button id="s" type="submit">ok</button></form><button id="ok">첨부</button>';
    for (const id of ['send', 't', 'a', 's']) {
      const el = document.getElementById(id) as HTMLElement;
      const spy = vi.fn();
      el.addEventListener('click', spy);
      expect(isForbidden(el, set)).toBe(true);
      expect(() => click(el, set)).toThrow(ForbiddenActionError);
      expect(spy).not.toHaveBeenCalled();
    }
    const ok = document.getElementById('ok') as HTMLElement;
    const spy = vi.fn();
    ok.addEventListener('click', spy);
    click(ok, set);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('pressKey는 허용 키 외를 거부한다', () => {
    const el = document.createElement('input');
    const seen: string[] = [];
    el.addEventListener('keydown', (e) => seen.push(e.key));
    pressKey(el, 'Enter');
    pressKey(el, ';');
    expect(seen).toEqual(['Enter', ';']);
    expect(() => pressKey(el, 'a' as never)).toThrow();
    expect(() => pressKey(el, 'Escape' as never)).toThrow();
  });

  it('setNativeValue는 prototype setter를 호출한다', () => {
    const el = document.createElement('input');
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    const calls: string[] = [];
    Object.defineProperty(HTMLInputElement.prototype, 'value', { ...desc, set(v: string) { calls.push(v); desc.set!.call(this, v); } });
    try {
      let own = 0;
      Object.defineProperty(el, 'value', { configurable: true, get: () => '', set: () => { own++; } });
      const onInput = vi.fn();
      el.addEventListener('input', onInput);
      setNativeValue(el, 'hello');
      expect(calls).toEqual(['hello']);
      expect(own).toBe(0);
      expect(onInput).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, 'value', desc);
    }
  });
});

describe('isForbidden 프로퍼티 판정', () => {
  const plain: ComposeSelectorSet = { ...set, forbidden: { send: [], textPatterns: ['보내기'] } };
  it('form 안의 type 없는 button은 거부한다', () => {
    document.body.innerHTML = '<form><button id="b">확인</button></form>';
    expect(isForbidden(document.getElementById('b')!, plain)).toBe(true);
  });
  it('form 밖의 type 없는 button은 허용한다', () => {
    document.body.innerHTML = '<button id="b">확인</button>';
    expect(isForbidden(document.getElementById('b')!, plain)).toBe(false);
  });
  it('input type=image는 거부한다', () => {
    document.body.innerHTML = '<input id="i" type="image">';
    expect(isForbidden(document.getElementById('i')!, plain)).toBe(true);
  });
  it('버튼 자손 svg 대상도 거부한다', () => {
    document.body.innerHTML = '<button>보내기<svg id="i"></svg></button>';
    expect(isForbidden(document.getElementById('i')!, plain)).toBe(true);
  });
  it('role=button 조상의 aria-label로 자손 span 대상을 거부한다', () => {
    document.body.innerHTML = '<div role="button" aria-label="보내기"><span id="s"></span></div>';
    expect(isForbidden(document.getElementById('s')!, plain)).toBe(true);
  });
  it('무관한 버튼의 자손 span 대상은 허용한다', () => {
    document.body.innerHTML = '<button>참조<span id="c"></span></button>';
    expect(isForbidden(document.getElementById('c')!, plain)).toBe(false);
  });
  it('자손 텍스트가 패턴과 맞으면 거부한다', () => {
    document.body.innerHTML = '<button id="b"><span>보내기</span></button>';
    expect(isForbidden(document.getElementById('b')!, plain)).toBe(true);
  });
});

describe('FileBuffer', () => {
  const b64 = (s: string) => btoa(s);
  it('순서대로 조립하고 File을 반환한다', async () => {
    const fb = new FileBuffer(1);
    fb.begin({ fileId: 'f', name: 'a.txt', size: 6, mime: 'text/plain' });
    await fb.push('f', 0, b64('abc'), 2);
    await fb.push('f', 1, b64('def'), 2);
    const f = fb.end('f');
    expect(f.name).toBe('a.txt');
    expect(f.size).toBe(6);
    expect(await f.text()).toBe('abcdef');
  });
  it('중복과 순서 어긋남을 거부한다', async () => {
    const fb = new FileBuffer(1);
    fb.begin({ fileId: 'f', name: 'a', size: 6 });
    await fb.push('f', 0, b64('abc'), 2);
    await expect(fb.push('f', 0, b64('abc'), 2)).rejects.toMatchObject({ code: 'DUPLICATE_CHUNK' });
    await expect(fb.push('f', 2, b64('abc'), 2)).rejects.toMatchObject({ code: 'OUT_OF_ORDER' });
  });
  it('크기가 다르면 end에서 throw한다', async () => {
    const fb = new FileBuffer(1);
    fb.begin({ fileId: 'f', name: 'a', size: 10 });
    await fb.push('f', 0, b64('abc'), 1);
    expect(() => fb.end('f')).toThrow(/크기/);
  });
  it('0바이트 파일은 청크 없이 end하면 빈 File이다', () => {
    const fb = new FileBuffer(1);
    fb.begin({ fileId: 'z', name: 'z.bin', size: 0 });
    const f = fb.end('z');
    expect(f.size).toBe(0);
    expect(f.name).toBe('z.bin');
  });
  it('총 보유량 상한을 넘는 begin을 거부한다', () => {
    const fb = new FileBuffer(1);   // 상한 2MB
    fb.begin({ fileId: 'a', name: 'a', size: 1.5 * 1024 * 1024 });
    expect(() => fb.begin({ fileId: 'b', name: 'b', size: 1024 * 1024 })).toThrow(/상한/);
    fb.release('a');
    expect(() => fb.begin({ fileId: 'b', name: 'b', size: 1024 * 1024 })).not.toThrow();
  });
});
