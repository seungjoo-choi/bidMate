// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mascotSrc } from '../../src/ui/mascot/assets';
import { createMascotImg, ensureMascotStyle, setMascotMood } from '../../src/ui/mascot/dom';

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('mascotSrc', () => {
  it('chrome이 없으면 /icon/mascot/ 경로', () => {
    expect(mascotSrc()).toBe('/icon/mascot/full.png');
    expect(mascotSrc('idle', 'face')).toBe('/icon/mascot/face.png');
  });
  it('happy는 웃는 그림, huh는 슬픈 그림', () => {
    expect(mascotSrc('happy')).toBe('/icon/mascot/full-happy.png');
    expect(mascotSrc('huh', 'face')).toBe('/icon/mascot/face-sad.png');
    expect(mascotSrc('work')).toBe('/icon/mascot/full.png');
  });
  it('chrome.runtime.getURL 스텁 결과를 쓴다', () => {
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` } });
    expect(mascotSrc()).toBe('chrome-extension://abc/icon/mascot/full.png');
  });
});

describe('ensureMascotStyle', () => {
  it('Document에 두 번 불러도 style 1개', () => {
    ensureMascotStyle(document);
    ensureMascotStyle(document);
    expect(document.querySelectorAll('style[data-bidmate-mascot]').length).toBe(1);
  });
  it('ShadowRoot에도 1개', () => {
    const shadow = document.createElement('div').attachShadow({ mode: 'open' });
    ensureMascotStyle(shadow);
    ensureMascotStyle(shadow);
    expect(shadow.querySelectorAll('style[data-bidmate-mascot]').length).toBe(1);
  });
});

describe('createMascotImg / setMascotMood', () => {
  it('속성 설정', () => {
    const img = createMascotImg(document, { mood: 'guide', size: 40 });
    expect(img.className).toBe('bm-mascot');
    expect(img.dataset.mood).toBe('guide');
    expect(img.getAttribute('width')).toBe('40');
    expect(img.alt).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });
  it('setMascotMood로 data-mood 변경', () => {
    const img = createMascotImg(document, { size: 40 });
    setMascotMood(img, 'happy');
    expect(img.dataset.mood).toBe('happy');
    expect(img.src).toContain('full-happy.png');
  });
});
