// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import probe from '../../src/entrypoints/probe';

type Api = {
  inspect(sel: string[], opts?: { depth?: number; maxMatches?: number }): { results: Array<Record<string, any>>; invalid: string[] };
  startRecording(opts?: { watch?: { selectors: string[]; intervalMs?: number } }): unknown;
  stopRecording(): { watches: Array<{ t: number; results: unknown[] }>; truncated: { watches: boolean }; events: Array<Record<string, unknown>> };
};
const api = (): Api => (window as unknown as { __bidMateProbe: Api }).__bidMateProbe;

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __bidMateProbe?: unknown }).__bidMateProbe;
  (probe as unknown as { main(): void }).main();
});
afterEach(() => {
  api().stopRecording();
  vi.useRealTimers();
});

describe('probe inspect', () => {
  it('깊이 제한을 지킨다', () => {
    document.body.innerHTML = '<div id="r"><div><div><div>deep</div></div></div></div>';
    const m = api().inspect(['#r'], { depth: 1 }).results[0]!;
    expect(m.subtree.children[0].children).toBeUndefined();
    const m2 = api().inspect(['#r'], { depth: 3 }).results[0]!;
    expect(m2.subtree.children[0].children[0].children[0].text).toBe('deep');
  });

  it('매치 개수 제한을 지킨다', () => {
    document.body.innerHTML = '<p class="a"></p>'.repeat(30);
    expect(api().inspect(['.a']).results).toHaveLength(20);
    expect(api().inspect(['.a'], { maxMatches: 3 }).results).toHaveLength(3);
  });

  it('input value를 수집하지 않고 type/name만 남긴다', () => {
    document.body.innerHTML = '<div id="r"><input type="text" name="subjectbox" value="비밀제목"></div>';
    const out = api().inspect(['#r']);
    const s = JSON.stringify(out);
    expect(s).not.toContain('비밀제목');
    expect(out.results[0]!.subtree.children[0]).toMatchObject({ tag: 'input', type: 'text', name: 'subjectbox' });
  });

  it('조상은 body까지 기록하고 잘못된 셀렉터는 invalid로 분리한다', () => {
    document.body.innerHTML = '<section id="s"><b id="x"></b></section>';
    const out = api().inspect(['#x', '!!bad']);
    expect(out.results[0]!.ancestors.map((a: any) => a.tag)).toEqual(['section', 'body']);
    expect(out.invalid).toEqual(['!!bad']);
  });
});

describe('probe watch', () => {
  it('직전과 같은 결과는 기록을 생략한다', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<i class="w">1</i>';
    api().startRecording({ watch: { selectors: ['.w'], intervalMs: 100 } });
    vi.advanceTimersByTime(500);
    document.querySelector('.w')!.textContent = '2';
    vi.advanceTimersByTime(300);
    const r = api().stopRecording();
    expect(r.watches).toHaveLength(2);
  });

  it('기록은 200회로 제한된다', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<i class="w">0</i>';
    api().startRecording({ watch: { selectors: ['.w'], intervalMs: 100 } });
    for (let i = 1; i <= 250; i++) {
      document.querySelector('.w')!.textContent = String(i);
      vi.advanceTimersByTime(100);
    }
    const r = api().stopRecording();
    expect(r.watches).toHaveLength(200);
    expect(r.truncated.watches).toBe(true);
  });

  it('hashchange로 바뀐 URL을 events에 기록한다', () => {
    api().startRecording();
    location.hash = '#a';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const r = api().stopRecording();
    expect(r.events.some((e) => e.type === 'hashchange' && String(e.to).endsWith('#a'))).toBe(true);
  });
});
