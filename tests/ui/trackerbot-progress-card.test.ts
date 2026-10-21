// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressCard } from '../../src/ui/progress-card/card';
import type { ProgressItem, ProgressPanelView } from '../../src/ui/progress-card/types';

beforeEach(() => { document.body.innerHTML = ''; });
const cbs = () => ({ cancel: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn(), toggleCollapse: vi.fn(), action: vi.fn(), hover: vi.fn(), force: vi.fn() });
const sr = (h: { host: HTMLElement }) => h.host.shadowRoot!;
const btns = (h: { host: HTMLElement }) => Array.from(sr(h).querySelectorAll('button')).filter((b) => !b.hidden);
const byText = (h: { host: HTMLElement }, t: string) => btns(h).find((b) => b.textContent === t)!;
const active: ProgressItem = { key: 'a', title: '공고 A', phase: 'collect', state: 'active', stepLabel: '첨부파일 다운로드 중 (2/6)', detail: 'a.hwp · 1.2 MB/3.4 MB', ratio: 0.5, cancel: { target: 'collect', cancelling: false } };
const done: ProgressItem = { key: 'd', title: '공고 D', phase: 'compose', state: 'warn', stepLabel: '메일 확인', actions: [{ id: 'open-mail', label: '메일 보기' }] };
const card = (...items: ProgressItem[]): ProgressPanelView => ({ kind: 'card', headline: 'BidMate · 1건 진행 중', items, moreCount: 0, activeCount: 1, settledCount: items.length - 1 });

describe('createProgressCard', () => {
  it('hidden -> .root 자식 0, host는 body에 연결', () => {
    const h = createProgressCard(document, cbs());
    h.render({ kind: 'hidden' });
    expect(sr(h).querySelector('.root')!.childElementCount).toBe(0);
    expect(h.host.isConnected).toBe(true);
    expect(h.host.parentElement).toBe(document.body);
    expect(h.host.getAttribute('data-bidmate')).toBe('progress');
  });
  it('card 항목 출력, active는 취소/끝난 항목은 닫기', () => {
    const h = createProgressCard(document, cbs());
    h.render(card(active, done));
    const items = sr(h).querySelectorAll('.item');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('.title')!.textContent).toBe('공고 A');
    expect(items[0]!.querySelector('.step')!.textContent).toBe('첨부파일 다운로드 중 (2/6)');
    expect(items[0]!.querySelector('.detail')!.textContent).toBe('a.hwp · 1.2 MB/3.4 MB');
    expect(Array.from(items[0]!.querySelectorAll('button')).filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['취소']);
    expect(Array.from(items[1]!.querySelectorAll('button')).filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['닫기', '메일 보기']);
  });
  it('콜백 호출과 전파 차단', () => {
    const on = cbs();
    const h = createProgressCard(document, on);
    const outerClick = vi.fn();
    const outerKey = vi.fn();
    document.body.addEventListener('click', outerClick);
    document.body.addEventListener('keydown', outerKey);
    h.render(card(active, done));
    byText(h, '취소').click();
    expect(on.cancel).toHaveBeenCalledWith('a');
    byText(h, '닫기').click();
    expect(on.dismiss).toHaveBeenCalledWith('d');
    byText(h, '모두 닫기').click();
    expect(on.dismissAll).toHaveBeenCalledTimes(1);
    byText(h, '접기').click();
    expect(on.toggleCollapse).toHaveBeenCalledTimes(1);
    byText(h, '메일 보기').click();
    expect(on.action).toHaveBeenCalledWith('d', 'open-mail');
    byText(h, '접기').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, composed: true }));
    expect(outerClick).not.toHaveBeenCalled();
    expect(outerKey).not.toHaveBeenCalled();
  });
  it('완료 후 선택: 끝난 ask 항목은 버튼 2개, 클릭 시 action(key, choose-compose)', () => {
    const on = cbs();
    const h = createProgressCard(document, on);
    const ask: ProgressItem = {
      key: 'q', title: '공고 Q', phase: 'collect', state: 'ok', stepLabel: '수집 완료', awaiting: true,
      actions: [{ id: 'choose-dashboard', label: '대시보드 편집' }, { id: 'choose-compose', label: '바로 작성' }],
    };
    h.render(card(active, ask));
    const items = sr(h).querySelectorAll('.item');
    expect(Array.from(items[1]!.querySelectorAll('button')).filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['닫기', '대시보드 편집', '바로 작성']);
    byText(h, '바로 작성').click();
    expect(on.action).toHaveBeenCalledWith('q', 'choose-compose');
  });
  it('pill -> 버튼 텍스트, 클릭 시 toggleCollapse', () => {
    const on = cbs();
    const h = createProgressCard(document, on);
    h.render({ kind: 'pill', text: '작업 2건 진행 중', activeCount: 2 });
    expect(btns(h).map((b) => b.textContent)).toEqual(['작업 2건 진행 중']);
    btns(h)[0]!.click();
    expect(on.toggleCollapse).toHaveBeenCalledTimes(1);
  });
  it('host.remove() 후 render -> 다시 body에 연결', () => {
    const h = createProgressCard(document, cbs());
    h.render({ kind: 'hidden' });
    h.host.remove();
    expect(h.host.isConnected).toBe(false);
    h.render({ kind: 'hidden' });
    expect(h.host.isConnected).toBe(true);
  });
  it('re-render 후 .list scrollTop 보존', () => {
    const h = createProgressCard(document, cbs());
    h.render(card(active, done));
    (sr(h).querySelector('.list') as HTMLElement).scrollTop = 40;
    h.render(card(active, done));
    expect((sr(h).querySelector('.list') as HTMLElement).scrollTop).toBe(40);
  });
  it('같은 key 재렌더: 버튼 노드 재사용, 텍스트·detail·게이지 갱신', () => {
    const h = createProgressCard(document, cbs());
    h.render(card(active));
    const cancelBtn = byText(h, '취소');
    const itemNode = sr(h).querySelector('.item');
    h.render(card({ ...active, stepLabel: '첨부파일 다운로드 중 (3/6)', detail: 'b.hwp · 2.0 MB', ratio: 0.8 }));
    expect(byText(h, '취소')).toBe(cancelBtn);
    expect(sr(h).querySelector('.item')).toBe(itemNode);
    expect(sr(h).querySelector('.step')!.textContent).toBe('첨부파일 다운로드 중 (3/6)');
    expect(sr(h).querySelector('.detail')!.textContent).toBe('b.hwp · 2.0 MB');
    expect((sr(h).querySelector('.gauge > i') as HTMLElement).style.width).toBe('80%');
    h.render(card({ ...active, cancel: { target: 'collect', cancelling: true } }));
    expect(byText(h, '취소 중…')).toBe(cancelBtn);
    expect(cancelBtn.disabled).toBe(true);
  });
  it('key가 빠지면 노드 제거, 순서 변경 반영', () => {
    const h = createProgressCard(document, cbs());
    const b: ProgressItem = { ...active, key: 'b', title: '공고 B' };
    const c: ProgressItem = { ...active, key: 'c', title: '공고 C' };
    const titles = () => Array.from(sr(h).querySelectorAll('.item .title')).map((t) => t.textContent);
    h.render(card(active, b, c));
    const nodeB = sr(h).querySelectorAll('.item')[1];
    expect(titles()).toEqual(['공고 A', '공고 B', '공고 C']);
    h.render(card(active, c));
    expect(titles()).toEqual(['공고 A', '공고 C']);
    h.render(card(c, b, active));
    expect(titles()).toEqual(['공고 C', '공고 B', '공고 A']);
    expect(sr(h).querySelectorAll('.item')[1]).not.toBe(nodeB); // 빠졌다 돌아온 key는 새 노드
  });
  it('inline: true -> render 후에도 body에 붙지 않고 .root.inline', () => {
    const h = createProgressCard(document, cbs(), { inline: true });
    h.render(card(active));
    expect(h.host.parentElement).toBeNull();
    expect(sr(h).querySelector('.root.inline')).not.toBeNull();
  });
  it('강제 중단: cancelling+force+on.force일 때만 보이고 클릭 시 on.force(key)', () => {
    const forced: ProgressItem = { ...active, cancel: { target: 'collect', cancelling: true, force: true } };
    const on = cbs();
    const h = createProgressCard(document, on);
    h.render(card(forced));
    const cancelBtn = byText(h, '취소 중…') as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    byText(h, '강제 중단').click();
    expect(on.force).toHaveBeenCalledWith('a');

    const { force: _f, ...noForce } = cbs();
    const h2 = createProgressCard(document, noForce);
    h2.render(card(forced));
    expect(btns(h2).some((b) => b.textContent === '강제 중단')).toBe(false);

    const h3 = createProgressCard(document, cbs());
    h3.render(card({ ...active, cancel: { target: 'collect', cancelling: false, force: true } }));
    expect(btns(h3).some((b) => b.textContent === '강제 중단')).toBe(false);
  });
});
