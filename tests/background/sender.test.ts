import { describe, expect, it } from 'vitest';
import { isOffscreenSender, senderKind } from '../../src/background/job-coordinator';

const ID = 'abcdefghijklmnop';

describe('발신자 판별', () => {
  it('확장 페이지/나라장터 탭/그 외를 구분', () => {
    expect(senderKind({ id: ID, url: `chrome-extension://${ID}/dashboard.html` }, ID)).toBe('extension');
    expect(senderKind({ id: ID, url: 'https://www.g2b.go.kr/', tab: { id: 3 } as chrome.tabs.Tab }, ID)).toBe('g2b');
    expect(senderKind({ id: ID, url: 'https://evil.example/', tab: { id: 3 } as chrome.tabs.Tab }, ID)).toBe('unknown');
    expect(senderKind({ id: 'other', url: `chrome-extension://other/x.html` }, ID)).toBe('unknown');
  });
  it('엔진 보고는 offscreen 문서에서 온 것만 인정', () => {
    expect(isOffscreenSender({ id: ID, url: `chrome-extension://${ID}/offscreen.html` }, ID)).toBe(true);
    expect(isOffscreenSender({ id: ID, url: `chrome-extension://${ID}/dashboard.html` }, ID)).toBe(false);
    expect(isOffscreenSender({ id: ID, url: 'https://www.g2b.go.kr/offscreen.html', tab: { id: 1 } as chrome.tabs.Tab }, ID)).toBe(false);
  });
});
