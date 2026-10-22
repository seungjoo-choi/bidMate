import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { NOTICE_TEXTS_MAX_CHARS } from '../../src/core/search/constants';
import type { ExtractionFile } from '../../src/core/types/extraction';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { readNoticeTexts } from '../../src/engine/notices/notice-api';
import { MemoryStore } from '../helpers/memory-store';

const ID = 'R26BK00000001-000';
const FOLDER = 'notices/A';
const T = `${FOLDER}/source/text`;
const file = (n: number, priority: number, extra: Partial<ExtractionFile> = {}): ExtractionFile => ({
  attachmentId: `a${n}`, name: `file${n}.hwp`, docKind: 'rfp', priority, status: 'parsed', textPath: `${T}/${n}.txt`, ...extra,
});

async function seed(opts: { detail?: boolean; files?: ExtractionFile[]; texts?: Record<string, string | Uint8Array> } = {}) {
  const store = new MemoryStore();
  const ns = new NoticeStore(store);
  const n = emptyNotice(ID, { noticeNo: 'R26BK00000001', round: '000' } as never, FOLDER, '2026-10-22T00:00:00+09:00');
  if (opts.detail) n.detailText = { textPath: `${T}/[상세] 나라장터 상세화면.txt`, capturedAt: '2026-10-22T00:00:00+09:00', chars: 3 };
  await ns.saveNotice(n);
  if (opts.files) {
    store.files.set(`${FOLDER}/extraction.json`, JSON.stringify({ schemaVersion: 2, noticeId: ID, jobId: 'job1', extractedAt: '', rulesVersion: 'x', status: 'ok', items: {}, extras: {}, files: opts.files, warnings: [] }));
  }
  for (const [p, t] of Object.entries(opts.texts ?? {})) store.files.set(p, t);
  return store;
}

describe('readNoticeTexts', () => {
  it('detail이 priority 0으로 맨 앞이고 첨부는 priority 순이다', async () => {
    const store = await seed({
      detail: true, files: [file(1, 5), file(2, 1), file(3, 5)],
      texts: { [`${T}/[상세] 나라장터 상세화면.txt`]: '상세', [`${T}/1.txt`]: 'a', [`${T}/2.txt`]: 'b', [`${T}/3.txt`]: 'c' },
    });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.extractionJobId).toBe('job1');
    expect(r.files.map((f) => [f.kind, f.priority, f.text])).toEqual([['detail', 0, '상세'], ['attachment', 1, 'b'], ['attachment', 5, 'a'], ['attachment', 5, 'c']]);
    expect(r.totalChars).toBe(5);
    expect(r.skipped).toEqual([]);
  });

  it('extraction이 없으면 detail만 돌려주고 detailText가 없으면 빈 목록이다', async () => {
    const store = await seed({ detail: true, texts: { [`${T}/[상세] 나라장터 상세화면.txt`]: '상세' } });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.extractionJobId).toBeNull();
    expect(r.files.map((f) => f.kind)).toEqual(['detail']);
    const none = await readNoticeTexts(await seed(), { noticeId: ID });
    expect(none.files).toEqual([]);
  });

  it('파일당 2MB로 자르고 truncated를 표시한다', async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 10).fill(97);
    const store = await seed({ files: [file(1, 1)], texts: { [`${T}/1.txt`]: big } });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.files[0]!.text.length).toBe(2 * 1024 * 1024);
    expect(r.files[0]!.truncated).toBe(true);
  });

  it('총합 상한을 넘으면 이후 파일은 text 비움 + skipped budget', async () => {
    const chunk = 'a'.repeat(2 * 1024 * 1024);
    const files = [file(1, 1), file(2, 2), file(3, 3)];
    const store = await seed({ files, texts: { [`${T}/1.txt`]: chunk, [`${T}/2.txt`]: chunk, [`${T}/3.txt`]: 'zzz' } });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.totalChars).toBeLessThanOrEqual(NOTICE_TEXTS_MAX_CHARS);
    expect(r.files[1]!.text).toBe('');
    expect(r.skipped).toEqual([{ name: 'file2.hwp', reason: 'budget' }]);
  });

  it('읽기에 실패한 파일은 skipped failed로 넣는다', async () => {
    const store = await seed({ files: [file(1, 1), file(2, 2)], texts: { [`${T}/2.txt`]: 'ok' } });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.files.map((f) => f.text)).toEqual(['ok']);
    expect(r.skipped).toEqual([{ name: 'file1.hwp', reason: 'failed' }]);
  });

  it('source/text 밖 textPath는 읽지 않고 skipped failed로 넣는다', async () => {
    const store = await seed({
      files: [file(1, 1, { textPath: `${FOLDER}/notice.json` }), file(2, 2, { textPath: '../x.txt' })],
      texts: { 'x.txt': 'secret' },
    });
    const r = await readNoticeTexts(store, { noticeId: ID });
    expect(r.files).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['failed', 'failed']);
  });

  it('NEEDS_FS_PERMISSION은 그대로 던진다', async () => {
    const store = await seed({ files: [file(1, 1)], texts: { [`${T}/1.txt`]: 'a' } });
    store.readBytes = async () => { throw Object.assign(new Error('perm'), { code: 'NEEDS_FS_PERMISSION' }); };
    await expect(readNoticeTexts(store, { noticeId: ID })).rejects.toMatchObject({ code: 'NEEDS_FS_PERMISSION' });
  });

  it('없는 공고는 NOT_FOUND', async () => {
    await expect(readNoticeTexts(new MemoryStore(), { noticeId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
