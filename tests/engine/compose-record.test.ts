import { describe, expect, it } from 'vitest';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { ComposeRecord } from '../../src/core/types/compose';
import { chunkBlob } from '../../src/engine/mail/chunker';
import { appendComposeRecord, markComposed } from '../../src/engine/mail/record';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

async function roundTrip(bytes: Uint8Array, chunkBytes?: number) {
  const parts: number[] = [];
  let total = -1;
  let n = 0;
  for await (const c of chunkBlob(new Blob([bytes as BlobPart]), chunkBytes)) {
    expect(c.seq).toBe(n++);
    total = c.total;
    for (const ch of atob(c.b64)) parts.push(ch.charCodeAt(0));
  }
  return { total, n, out: Uint8Array.from(parts) };
}

describe('chunkBlob', () => {
  it('0바이트: total 0, 청크 없음', async () => {
    const r = await roundTrip(new Uint8Array(0));
    expect(r.n).toBe(0);
    expect(r.out.length).toBe(0);
  });
  it('경계: 정확히 chunkBytes 배수', async () => {
    const b = Uint8Array.from({ length: 30 }, (_, i) => i);
    const r = await roundTrip(b, 10);
    expect(r.total).toBe(3);
    expect(Array.from(r.out)).toEqual(Array.from(b));
  });
  it('2MB+1 왕복', async () => {
    const b = Uint8Array.from({ length: 2 * 1024 * 1024 + 1 }, (_, i) => i % 251);
    const r = await roundTrip(b);
    expect(r.total).toBe(2);
    expect(r.out.length).toBe(b.length);
    expect(r.out.every((v, i) => v === b[i])).toBe(true);
  });
});

const rec = (id: string): ComposeRecord => ({
  id, jobId: 'j', noticeId: 'n', composedAt: '2026-10-18T00:00:00.000Z', templateId: 't',
  snapshot: { to: [], cc: [], subject: '', html: '' }, fields: [], attachments: [], outcome: 'partial',
  adapterId: 'naverworks', selectorSetVersion: 'v', webmailUrl: 'https://x/',
});

describe('appendComposeRecord', () => {
  it('없으면 만들고 이어서 추가한다', async () => {
    const mem = new MemoryStore();
    await appendComposeRecord(mem, 'f', rec('a'));
    await appendComposeRecord(mem, 'f', rec('b'));
    expect((JSON.parse(await mem.readText('f/mail.json')) as ComposeRecord[]).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('손상된 파일은 빈 배열에서 시작한다', async () => {
    const mem = new MemoryStore();
    await mem.writeText('f/mail.json', '{broken');
    await appendComposeRecord(mem, 'f', rec('a'));
    expect(JSON.parse(await mem.readText('f/mail.json'))).toHaveLength(1);
  });
});

describe('markComposed', () => {
  async function setup(status: 'none' | 'delivered') {
    const mem = new MemoryStore();
    const n = sampleNotice();
    n.id = 'R1'; n.folder = 'notices/2026/R1_가'; n.mail = { status };
    await new NoticeStore(mem).saveNotice(n);
    return mem;
  }
  const NOW = new Date('2026-10-18T09:00:00.000Z');
  it('ready_for_review와 lastComposedAt을 기록한다', async () => {
    const mem = await setup('none');
    await markComposed(mem, 'R1', 'partial', NOW);
    const n = await new NoticeStore(mem).loadNotice('R1');
    expect(n?.mail.status).toBe('ready_for_review');
    expect(n?.mail.lastComposedAt).toBe(NOW.toISOString());
  });
  it('delivered는 유지, failed는 변경 없음', async () => {
    const mem = await setup('delivered');
    await markComposed(mem, 'R1', 'ready_for_review', NOW);
    expect((await new NoticeStore(mem).loadNotice('R1'))?.mail.status).toBe('delivered');
    const mem2 = await setup('none');
    await markComposed(mem2, 'R1', 'failed', NOW);
    expect((await new NoticeStore(mem2).loadNotice('R1'))?.mail.status).toBe('none');
  });
});
