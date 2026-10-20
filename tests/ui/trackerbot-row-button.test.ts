// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowButton } from '../../src/ui/trackerbot/row-button';

let anchor: HTMLAnchorElement;
beforeEach(() => {
  document.body.innerHTML = '<table><tr><td><a href="https://www.g2b.go.kr/x" class="c">바로가기</a></td></tr></table>';
  anchor = document.querySelector('a')!;
});
const cbs = () => ({ collect: vi.fn(), reveal: vi.fn(), action: vi.fn() });
const btns = (h: { host: HTMLElement }) => Array.from(h.host.shadowRoot!.querySelectorAll('button'));

describe('createRowButton', () => {
  it('afterend 삽입, 앵커 불변', () => {
    const before = anchor.outerHTML;
    const h = createRowButton(anchor, cbs());
    expect(anchor.nextElementSibling).toBe(h.host);
    expect(h.host.getAttribute('data-bidmate')).toBe('collect');
    expect(anchor.outerHTML).toBe(before);
    expect(anchor.textContent).toBe('바로가기');
  });
  it('render 전환', () => {
    const h = createRowButton(anchor, cbs());
    h.render({ kind: 'idle', label: '공고 수집', tone: 'primary' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['공고 수집']);
    expect(btns(h)[0]!.querySelector('.bm-mascot')).not.toBeNull();
    h.render({ kind: 'busy', label: '수집 중', detail: '첨부 1/2', canCancel: true, cancelling: false, cancelTarget: 'collect' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['수집 중']);
    expect(btns(h)[0]!.title).toContain('첨부 1/2');
    expect(btns(h)[0]!.querySelector('.bm-mascot')).toBeNull();
    expect(btns(h)[0]!.querySelector('.spin')).not.toBeNull();
    h.render({ kind: 'done', label: '수집 완료', tone: 'ok', canRetry: false });
    expect(btns(h).map((b) => b.textContent)).toEqual(['수집 완료']);
    expect(btns(h)[0]!.querySelector('.bm-mascot')).toBeNull();
    expect(btns(h)[0]!.querySelector('.ic')).not.toBeNull();
  });
  it('이미 수집한 공고: 완료 알약(요약) + 다시 수집 아이콘', () => {
    const on = cbs();
    const h = createRowButton(anchor, on);
    h.render({ kind: 'idle', label: '다시 수집', chip: '수집 완료', chipTone: 'ok', tone: 'secondary' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['수집 완료', '']);
    expect(btns(h)[1]!.getAttribute('aria-label')).toBe('다시 수집');
    expect(btns(h)[0]!.parentElement).toBe(btns(h)[1]!.parentElement);
    btns(h)[0]!.click();
    expect(on.action).toHaveBeenCalledWith('sidepanel');
    btns(h)[1]!.click();
    expect(on.collect).toHaveBeenCalledTimes(1);
    h.render({ kind: 'idle', label: '다시 수집', tone: 'secondary' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['다시 수집']);
  });
  it('클릭 콜백 호출과 전파 차단', () => {
    const on = cbs();
    const h = createRowButton(anchor, on);
    const outer = vi.fn();
    document.body.addEventListener('click', outer);
    h.render({ kind: 'idle', label: '공고 수집', tone: 'primary' });
    btns(h)[0]!.click();
    expect(on.collect).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    h.render({ kind: 'busy', label: 'x', canCancel: true, cancelling: false, cancelTarget: 'collect' });
    btns(h)[0]!.click();
    expect(on.reveal).toHaveBeenCalledTimes(1);
    h.render({ kind: 'error', label: '오류', action: 'grant', actionLabel: '폴더 접근 허용' });
    btns(h)[0]!.click();
    expect(on.action).toHaveBeenCalledWith('grant');
  });
  it('dispose', () => {
    const h = createRowButton(anchor, cbs());
    h.dispose();
    expect(document.querySelector('[data-bidmate]')).toBeNull();
  });

  it('done/error 보조 버튼', () => {
    const on = cbs();
    const h = createRowButton(anchor, on);
    h.render({ kind: 'done', label: '메일 작성됨', tone: 'ok', canRetry: false, action: 'open-mail', actionLabel: '열기' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['메일 작성됨', '열기']);
    btns(h)[1]!.click();
    expect(on.action).toHaveBeenCalledWith('open-mail');
    h.render({ kind: 'error', label: '메일 작성 실패', action: 'none', subAction: 'settings', subActionLabel: '설정 열기' });
    expect(btns(h).map((b) => b.textContent)).toEqual(['메일 작성 실패', '설정 열기']);
    expect(btns(h)[0]!.disabled).toBe(true);
    btns(h)[1]!.click();
    expect(on.action).toHaveBeenCalledWith('settings');
  });

  it('error 실패 이유는 버튼 아래에 바로 보인다', () => {
    const h = createRowButton(anchor, cbs());
    h.render({ kind: 'error', label: '메일 작성 실패', action: 'retry', actionLabel: '다시 시도', message: '받을 수신자가 없습니다' });
    const msg = h.host.shadowRoot!.querySelector('.msg');
    expect(msg?.textContent).toBe('받을 수신자가 없습니다');
    h.render({ kind: 'error', label: '수집 실패', action: 'retry' });
    expect(h.host.shadowRoot!.querySelector('.msg')).toBeNull();
  });
});
