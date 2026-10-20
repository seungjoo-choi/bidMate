import { describe, expect, it, vi } from 'vitest';
import { dedupePrespec, sha256Hex } from '../../src/engine/jobs/prespec-dedupe';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { Attachment, Notice } from '../../src/core/types/notice';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/n';
const enc = (s: string) => new TextEncoder().encode(s);
const mk = (id: string, name: string, content: string, over: Partial<Attachment> = {}): Attachment => ({
  id, index: 0, originalName: name, savedName: name, url: `u/${id}`, expectedSize: null, savedSize: enc(content).length, status: 'saved', attempts: 1, ...over,
});
function setup(bid: [string, string], pre: [string, string], preOver: Partial<Attachment> = {}) {
  const store = new MemoryStore();
  const n: Notice = emptyNotice('N-000', { noticeNo: 'N', origin: 'g2b' }, FOLDER, '2026-10-17T00:00:00Z');
  n.attachments = [mk('b', bid[0], bid[1]), mk('p', pre[0], pre[1], { origin: 'prespec', ...preOver })];
  store.files.set(`${FOLDER}/attachments/${bid[0]}`, enc(bid[1]));
  store.files.set(`${FOLDER}/attachments/${pre[0]}`, enc(pre[1]));
  return { store, n };
}

describe('dedupePrespec', () => {
  it('이름 키가 같으면 내용이 달라도 파일을 지우고 skipped/duplicateOf', async () => {
    const { store, n } = setup(['제안요청서 (최종).hwp', 'AAA'], ['제안요청서(최종).HWP', 'BBBB']);
    expect(await dedupePrespec(n, store)).toBe(true);
    const p = n.attachments[1]!;
    expect(p).toMatchObject({ status: 'skipped', duplicateOf: 'b', savedSize: null, savedName: '제안요청서(최종).HWP' });
    expect(p.savedAt).toBeUndefined();
    expect(p.note).toBe('입찰공고 첨부와 중복(사전규격)');
    expect(store.files.has(`${FOLDER}/attachments/제안요청서(최종).HWP`)).toBe(false);
    expect(store.files.has(`${FOLDER}/attachments/제안요청서 (최종).hwp`)).toBe(true);
  });
  it('이름이 달라도 크기와 내용이 같으면 동일 처리하고 sha256을 기록', async () => {
    const { store, n } = setup(['공고서.hwp', 'SAME'], ['규격서.hwp', 'SAME']);
    expect(await dedupePrespec(n, store)).toBe(true);
    expect(n.attachments[1]).toMatchObject({ status: 'skipped', duplicateOf: 'b', sha256: await sha256Hex(enc('SAME')) });
    expect(store.files.has(`${FOLDER}/attachments/규격서.hwp`)).toBe(false);
  });
  it('크기만 같고 내용이 다르면 유지', async () => {
    const { store, n } = setup(['공고서.hwp', 'AAAA'], ['규격서.hwp', 'BBBB']);
    expect(await dedupePrespec(n, store)).toBe(false);
    expect(n.attachments[1]).toMatchObject({ status: 'saved' });
    expect(n.attachments[1]).not.toHaveProperty('duplicateOf');
    expect(store.files.has(`${FOLDER}/attachments/규격서.hwp`)).toBe(true);
  });
  it('크기가 다르면 readBytes를 호출하지 않는다', async () => {
    const { store, n } = setup(['공고서.hwp', 'AAA'], ['규격서.hwp', 'BBBB']);
    const spy = vi.spyOn(store, 'readBytes');
    expect(await dedupePrespec(n, store)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it('이미 sha256이 있으면 다시 계산하지 않는다', async () => {
    const { store, n } = setup(['공고서.hwp', 'SAME'], ['규격서.hwp', 'SAME']);
    const h = await sha256Hex(enc('SAME'));
    n.attachments[0]!.sha256 = h;
    n.attachments[1]!.sha256 = h;
    const spy = vi.spyOn(store, 'readBytes');
    expect(await dedupePrespec(n, store)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it('bid 하나의 readBytes가 실패해도 다음 bid와 계속 비교한다', async () => {
    const { store, n } = setup(['첫째.hwp', 'SAME'], ['규격서.hwp', 'SAME']);
    n.attachments.splice(1, 0, mk('b2', '둘째.hwp', 'SAME'));
    store.files.set(`${FOLDER}/attachments/둘째.hwp`, enc('SAME'));
    const orig = store.readBytes.bind(store);
    vi.spyOn(store, 'readBytes').mockImplementation(async (path: string) => {
      if (path.endsWith('/첫째.hwp')) throw new Error('read fail');
      return orig(path);
    });
    expect(await dedupePrespec(n, store)).toBe(true);
    expect(n.attachments[2]).toMatchObject({ status: 'skipped', duplicateOf: 'b2' });
  });
});
