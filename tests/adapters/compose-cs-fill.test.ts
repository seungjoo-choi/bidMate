import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (p: any) => unknown>();
const calls: string[] = [];
vi.mock('wxt/utils/define-unlisted-script', () => ({ defineUnlistedScript: (fn: () => void) => fn }));
vi.mock('../../src/messaging/bus', () => ({ listen: (type: string, fn: (p: any) => unknown) => { handlers.set(type, fn); } }));
vi.mock('../../src/adapters/naverworks/engine', () => ({
  GenericComposeAdapter: class {
    constructor(..._a: unknown[]) { /* 스텁 */ }
    detect() { return { isCompose: true, ready: false, reason: 'SCOPE_AMBIGUOUS' }; }
    async setRecipients(role: string) { calls.push(role); return { field: role }; }
    async setSubject() { calls.push('subject'); return { field: 'subject' }; }
    async setBody() { calls.push('body'); return { field: 'body' }; }
  },
}));
vi.mock('../../src/adapters/naverworks/selectors', () => ({ SELECTOR_SETS: { s: {} }, mergeSelectorSet: (b: unknown) => b }));
vi.mock('../../src/adapters/naverworks/file-buffer', () => ({ FileBuffer: class {} }));

describe('naverworks-compose CS', () => {
  beforeEach(async () => {
    calls.length = 0;
    handlers.clear();
    vi.stubGlobal('window', globalThis);
    delete (globalThis as { __bidMateCompose?: unknown }).__bidMateCompose;
    vi.stubGlobal('document', {});
    const mod = await import('../../src/entrypoints/naverworks-compose');
    (mod.default as unknown as () => void)();
    (globalThis as any).__bidMateCompose.configure({ selectorSetId: 's', jobId: 'j' });
  });

  it('fields를 주면 요청한 필드만 요청 순서대로 실행한다', async () => {
    const r = await handlers.get('compose/fill')!({ jobId: 'j', to: [], cc: [], subject: 's', html: 'h', fields: ['body', 'to'] }) as Array<{ field: string }>;
    expect(calls).toEqual(['body', 'to']);
    expect(r.map((x) => x.field)).toEqual(['body', 'to']);
  });
  it('fields를 생략하면 4필드 전부 to, cc, subject, body 순서', async () => {
    await handlers.get('compose/fill')!({ jobId: 'j', to: [], cc: [], subject: 's', html: 'h' });
    expect(calls).toEqual(['to', 'cc', 'subject', 'body']);
  });
  it('detect가 reason을 전달한다', () => {
    expect((globalThis as any).__bidMateCompose.detect()).toMatchObject({ isCompose: true, ready: false, reason: 'SCOPE_AMBIGUOUS' });
  });
});
