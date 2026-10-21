import { describe, expect, it } from 'vitest';

type GlobMap = Record<string, string>;
type Meta = { glob(pattern: string, opts: { query: string; import: string; eager: true }): GlobMap };

const adapterSrc = (import.meta as unknown as Meta).glob('../../src/adapters/naverworks/**/*.ts', { query: '?raw', import: 'default', eager: true });
const gmailSrc = (import.meta as unknown as Meta).glob('../../src/adapters/gmail/**/*.ts', { query: '?raw', import: 'default', eager: true });
const csSrc = (import.meta as unknown as Meta).glob('../../src/entrypoints/naverworks-compose.ts', { query: '?raw', import: 'default', eager: true });
const trackerAdapterSrc = (import.meta as unknown as Meta).glob('../../src/adapters/trackerbot/**/*.ts', { query: '?raw', import: 'default', eager: true });
const trackerUiSrc = (import.meta as unknown as Meta).glob('../../src/ui/trackerbot/**/*.ts', { query: '?raw', import: 'default', eager: true });
const trackerCsSrc = (import.meta as unknown as Meta).glob('../../src/entrypoints/trackerbot-mail.ts', { query: '?raw', import: 'default', eager: true });
const watchSrc = (import.meta as unknown as Meta).glob('../../src/entrypoints/send-watch.ts', { query: '?raw', import: 'default', eager: true });
const bgSrc = (import.meta as unknown as Meta).glob('../../src/background/**/*.ts', { query: '?raw', import: 'default', eager: true });
const all = { ...adapterSrc, ...gmailSrc, ...csSrc, ...trackerAdapterSrc, ...trackerUiSrc, ...trackerCsSrc, ...watchSrc };
const isDomActions = (p: string): boolean => p.endsWith('/dom-actions.ts');

describe('금지된 디스패치 소스 스캔', () => {
  const banned = [/\.click\(/, /dispatchEvent\(/, /\.submit\(/, /requestSubmit\(/, /execCommand\(/];

  it('dom-actions.ts 외에는 금지 호출이 없다', () => {
    const targets = Object.entries(all).filter(([p]) => !isDomActions(p));
    expect(targets.length).toBeGreaterThan(4);
    const hits: string[] = [];
    for (const [p, src] of targets) for (const re of banned) if (re.test(src)) hits.push(`${p}: ${re}`);
    expect(hits).toEqual([]);
  });

  it('send-watch.ts는 포함돼 있고 dom-actions를 import하지 않는다', () => {
    const entry = Object.entries(watchSrc);
    expect(entry).toHaveLength(1);
    expect(entry[0]![1]).not.toMatch(/dom-actions/);
  });

  it('background에서 .click(은 send-trigger.ts에 정확히 1회만 있다', () => {
    const entries = Object.entries(bgSrc);
    expect(entries.length).toBeGreaterThan(3);
    const isTrigger = (p: string): boolean => p.endsWith('/send-trigger.ts');
    const trigger = entries.find(([p]) => isTrigger(p));
    expect(trigger).toBeDefined();
    expect(trigger![1].match(/\.click\(/g)).toHaveLength(1);
    const others = entries.filter(([p]) => !isTrigger(p)).filter(([, src]) => /\.click\(/.test(src)).map(([p]) => p);
    expect(others).toEqual([]);
  });

  it('send-trigger.ts에 다른 디스패치·키 조합 경로가 없다', () => {
    const src = Object.entries(bgSrc).find(([p]) => p.endsWith('/send-trigger.ts'))![1];
    for (const re of [/dispatchEvent\(/, /KeyboardEvent/, /ctrlKey|metaKey/, /execCommand\(/, /\.submit\(/, /requestSubmit\(/]) expect(src).not.toMatch(re);
  });

  it('dom-actions.ts에 modifier 키가 없다', () => {
    const entry = Object.entries(all).find(([p]) => isDomActions(p));
    expect(entry).toBeDefined();
    expect(entry![1]).not.toMatch(/ctrlKey|metaKey|altKey/);
  });
});
