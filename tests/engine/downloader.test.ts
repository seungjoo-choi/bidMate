import { describe, expect, it, vi } from 'vitest';
import { downloadAttachments } from '../../src/engine/downloader/downloader';
import type { Attachment } from '../../src/core/types/notice';
import { MemoryStore } from '../helpers/memory-store';

const att = (name: string, over: Partial<Attachment> = {}): Attachment => ({
  id: name, index: 0, originalName: name, savedName: null, url: `https://x/${name}`,
  expectedSize: null, savedSize: null, status: 'pending', attempts: 0, ...over,
});
const settings = { concurrency: 2, maxRetries: 3, backoffMs: 1, maxFileMB: 100 };
const body = (s: string, headers: Record<string, string> = {}, status = 200) =>
  new Response(s, { status, headers: { 'content-length': String(new TextEncoder().encode(s).length), ...headers } });
const base = (store: MemoryStore, fetchFn: unknown) => ({
  store, folder: 'notices/2026/n', settings, fetch: fetchFn as typeof fetch, sleep: async () => undefined,
});

describe('downloadAttachments', () => {
  it('성공', async () => {
    const store = new MemoryStore();
    const [a] = await downloadAttachments([att('a.pdf')], base(store, async () => body('hello')));
    expect(a?.status).toBe('saved');
    expect(a?.savedSize).toBe(5);
    expect(store.files.has('notices/2026/n/attachments/a.pdf')).toBe(true);
  });
  it('content-length 불일치 → size_mismatch', async () => {
    const store = new MemoryStore();
    const [a] = await downloadAttachments([att('a.pdf')], base(store, async () => body('hello', { 'content-length': '99' })));
    expect(a?.status).toBe('size_mismatch');
  });
  it('text/html → 실패(ATTACH_NOT_FILE), 재시도 없음', async () => {
    const store = new MemoryStore();
    const f = vi.fn(async () => body('<html>', { 'content-type': 'text/html; charset=utf-8' }));
    const [a] = await downloadAttachments([att('a.pdf')], base(store, f));
    expect(a?.status).toBe('failed');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('2회 실패 후 성공', async () => {
    const store = new MemoryStore();
    let n = 0;
    const f = vi.fn(async () => (++n <= 2 ? body('x', {}, 503) : body('ok')));
    const [a] = await downloadAttachments([att('a.pdf')], base(store, f));
    expect(a?.status).toBe('saved');
    expect(f).toHaveBeenCalledTimes(3);
    expect(a?.attempts).toBe(3);
  });
  it('이미 saved이고 크기가 같으면 fetch하지 않는다', async () => {
    const store = new MemoryStore();
    store.files.set('notices/2026/n/attachments/a.pdf', new Uint8Array(5));
    const f = vi.fn();
    const [a] = await downloadAttachments([att('a.pdf', { savedName: 'a.pdf', status: 'saved', savedSize: 5 })], base(store, f));
    expect(f).not.toHaveBeenCalled();
    expect(a?.status).toBe('saved');
  });
  it('동일 파일명 2개 → a (2).pdf', async () => {
    const store = new MemoryStore();
    const out = await downloadAttachments([att('a.pdf', { id: '1' }), att('a.pdf', { id: '2' })], base(store, async () => body('z')));
    expect(out.map((x) => x.savedName)).toEqual(['a.pdf', 'a (2).pdf']);
  });
  it('최대 크기 초과는 skipped', async () => {
    const store = new MemoryStore();
    const [a] = await downloadAttachments([att('big.zip')], {
      ...base(store, async () => body('x', { 'content-length': String(200 * 1024 * 1024) })),
    });
    expect(a?.status).toBe('skipped');
  });
  it('DISK_FULL은 즉시 중단', async () => {
    const store = new MemoryStore();
    store.failStreamFor.add('notices/2026/n/attachments/a.pdf');
    await expect(downloadAttachments([att('a.pdf')], base(store, async () => body('x')))).rejects.toMatchObject({ code: 'DISK_FULL', retryable: false });
  });
  it('idle 타임아웃 → ATTACH_TIMEOUT 후 재시도', async () => {
    const store = new MemoryStore();
    let n = 0;
    const stalled = () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { headers: { 'content-length': '5' } });
    const f = vi.fn(async () => (++n === 1 ? stalled() : body('hello')));
    const [a] = await downloadAttachments([att('a.pdf')], { ...base(store, f), idleTimeoutMs: 20 });
    expect(a?.status).toBe('saved');
    expect(a?.attempts).toBe(2);
  });
  it('재시도 한도까지 계속 타임아웃이면 failed + ATTACH_TIMEOUT 메시지', async () => {
    const store = new MemoryStore();
    const f = async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }));
    const [a] = await downloadAttachments([att('a.pdf')], { ...base(store, f), idleTimeoutMs: 10, settings: { ...settings, maxRetries: 1 } });
    expect(a?.status).toBe('failed');
    expect(a?.lastError).toContain('시간 초과');
    expect(store.files.has('notices/2026/n/attachments/a.pdf')).toBe(false);
  });
  it('content-length 없음 + 크기 초과 → skipped, 파일 남지 않음', async () => {
    const store = new MemoryStore();
    const f = async () => new Response('x'.repeat(500));
    const [a] = await downloadAttachments([att('a.bin')], { ...base(store, f), settings: { ...settings, maxFileMB: 0.0001 } });
    expect(a?.status).toBe('skipped');
    expect(a?.lastError).toContain('초과');
    expect(store.files.has('notices/2026/n/attachments/a.bin')).toBe(false);
  });
  it('content-length 없으면 size_mismatch 검사 없이 saved + note', async () => {
    const store = new MemoryStore();
    const [a] = await downloadAttachments([att('a.bin')], base(store, async () => new Response('abc')));
    expect(a?.status).toBe('saved');
    expect(a?.note).toBe('서버가 크기를 알려주지 않음');
  });
  it('신규 파일 쓰기 실패 시 부분 파일이 남지 않는다', async () => {
    const store = new MemoryStore();
    store.failStreamFor.add('notices/2026/n/attachments/a.pdf');
    await expect(downloadAttachments([att('a.pdf')], base(store, async () => body('x')))).rejects.toMatchObject({ code: 'DISK_FULL' });
    expect(store.files.has('notices/2026/n/attachments/a.pdf')).toBe(false);
  });
  it('취소 신호를 받으면 JOB_CANCELLED로 중단', async () => {
    const store = new MemoryStore();
    const ac = new AbortController();
    const f = async () => { setTimeout(() => ac.abort(), 10); return new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })); };
    await expect(downloadAttachments([att('a.pdf')], { ...base(store, f), signal: ac.signal })).rejects.toMatchObject({ code: 'JOB_CANCELLED' });
  });
  it('backoff 대기 중 abort → sleep이 끝나기 전에 CancelledError', async () => {
    const store = new MemoryStore();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const started = Date.now();
    const f = async () => body('x', {}, 503);
    await expect(downloadAttachments([att('a.pdf')], {
      ...base(store, f), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), settings: { ...settings, backoffMs: 5000 }, signal: ac.signal,
    })).rejects.toMatchObject({ code: 'JOB_CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
