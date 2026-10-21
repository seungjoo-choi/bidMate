import { describe, expect, it, vi } from 'vitest';
import { sampleNotice, samplePrespecNotice } from '../../src/core/templates/sample-notice';
import type { SendRecord, SentArchiveFile } from '../../src/core/types/compose';
import type { EvalRecord } from '../../src/core/types/evaluation';
import type { IndexFile } from '../../src/core/types/index-file';
import type { RfpCompareSession, RfpDocRef } from '../../src/core/types/rfp';
import { EvalStore } from '../../src/engine/evaluation/eval-store';
import { SENT_INDEX_PATH, SentStore, sentArchivePath, sentPath } from '../../src/engine/mail/sent-store';
import { deleteNotices, type DeleteNoticeDeps } from '../../src/engine/notices/delete-notice';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { createRfpService } from '../../src/engine/rfp/rfp-service';
import { MemoryStore } from '../helpers/memory-store';

const NOW = new Date('2026-10-21T09:00:00.000Z');
const A = 'R26BK00000001-000';
const B = 'R26BK00000002-000';
const C = 'R26BK00000003-000';
const folderOf = (id: string) => `notices/2026/${id}_가`;

async function addNotice(mem: MemoryStore, id: string, mail?: Partial<ReturnType<typeof sampleNotice>['mail']>) {
  const n = sampleNotice();
  n.id = id; n.folder = folderOf(id);
  if (mail) n.mail = { ...n.mail, ...mail };
  await new NoticeStore(mem).saveNotice(n);
  await mem.writeText(`${n.folder}/extraction.json`, '{}');
  await mem.writeText(`${n.folder}/attachments/a.hwp`, 'x');
  await mem.writeText(`${n.folder}/ai-review.json`, '{}');
  return n;
}
const deps = (mem: MemoryStore, over: Partial<DeleteNoticeDeps> = {}): DeleteNoticeDeps =>
  ({ store: mem, isBusy: () => false, deleteCompares: async () => [], now: () => NOW, ...over });
const rec = (id: string, noticeId: string, over: Partial<SendRecord> = {}): SendRecord => ({
  id, noticeId, sentAt: '2026-10-19T00:00:00.000Z', recordedAt: '2026-10-19T00:00:00.000Z', source: 'manual',
  summary: { subject: '제목', toCount: 1, ccCount: 0, attachmentCount: 0 }, ...over,
});
const json = <T>(mem: MemoryStore, p: string): T => JSON.parse(mem.files.get(p) as string) as T;
const noticeFiles = (mem: MemoryStore) => [...mem.files.keys()].filter((k) => k.startsWith('notices/'));
const indexIds = (mem: MemoryStore) => json<IndexFile>(mem, 'index.json').notices.map((e) => e.noticeId);

describe('deleteNotices', () => {
  it('1. 폴더 전체와 index 항목을 지운다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const r = await deleteNotices([A], deps(mem));
    expect(r.deleted).toEqual([A]);
    expect(r.failed).toEqual([]);
    expect(indexIds(mem)).toEqual([]);
    expect(noticeFiles(mem)).toEqual([]);
  });

  it('2. 없는 id는 deleted에 포함되고 파일은 그대로', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const before = [...mem.files.keys()].sort();
    const r = await deleteNotices(['nope'], deps(mem));
    expect(r.deleted).toEqual(['nope']);
    expect(r.failed).toEqual([]);
    expect([...mem.files.keys()].sort()).toEqual(before);
  });

  it('3. busy면 JOB_ALREADY_RUNNING, 폴더와 index 그대로', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const before = noticeFiles(mem).length;
    const r = await deleteNotices([A], deps(mem, { isBusy: () => true }));
    expect(r.deleted).toEqual([]);
    expect(r.failed[0]!.code).toBe('JOB_ALREADY_RUNNING');
    expect(noticeFiles(mem)).toHaveLength(before);
    expect(indexIds(mem)).toEqual([A]);
  });

  it('4. 3건 중 2번째만 busy면 deleted 2, failed 1', async () => {
    const mem = new MemoryStore();
    for (const id of [A, B, C]) await addNotice(mem, id);
    const r = await deleteNotices([A, B, C], deps(mem, { isBusy: (id) => id === B }));
    expect(r.deleted).toEqual([A, C]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ noticeId: B, code: 'JOB_ALREADY_RUNNING' });
    expect(indexIds(mem)).toEqual([B]);
  });

  it('5. 발송 이력 2건(1건 voided)을 보관하고 sent index에 noticeDeleted로 남긴다', async () => {
    const mem = new MemoryStore();
    const n = await addNotice(mem, A);
    await mem.writeText(sentPath(n.folder), JSON.stringify([rec('r1', A), rec('r2', A, { voidedAt: '2026-10-20T00:00:00.000Z' })]));
    await new SentStore(mem).loadIndex();
    const title = (await new NoticeStore(mem).findEntry(A))!.title;
    await deleteNotices([A], deps(mem));
    const arc = json<SentArchiveFile>(mem, sentArchivePath(A));
    expect(arc.records).toHaveLength(2);
    expect(arc.entry.title).toBe(title);
    const idx = await new SentStore(mem).loadIndex();
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries.every((e) => e.noticeDeleted === true && e.folder === '' && e.noticeId === A)).toBe(true);
    expect(noticeFiles(mem)).toEqual([]);
  });

  it('6. mail-sent.json이 없고 delivered면 legacy 1건을 보관한다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A, { status: 'delivered', deliveredAt: '2026-10-19T00:00:00.000Z' });
    await deleteNotices([A], deps(mem));
    const arc = json<SentArchiveFile>(mem, sentArchivePath(A));
    expect(arc.records).toHaveLength(1);
    expect(arc.records[0]!.id).toBe(`legacy-${A}`);
  });

  it('7. 이력이 없으면 보관 파일도 sent index 항목도 없다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    await deleteNotices([A], deps(mem));
    expect(mem.files.has(sentArchivePath(A))).toBe(false);
    expect((await new SentStore(mem).loadIndex()).entries).toEqual([]);
  });

  it('8. mail-sent-index.json이 사라져도 보관본에서 복원된다', async () => {
    const mem = new MemoryStore();
    const n = await addNotice(mem, A);
    await mem.writeText(sentPath(n.folder), JSON.stringify([rec('r1', A), rec('r2', A)]));
    await deleteNotices([A], deps(mem));
    mem.files.delete(SENT_INDEX_PATH);
    const idx = await new SentStore(mem).loadIndex();
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries.every((e) => e.noticeDeleted === true && e.folder === '')).toBe(true);
  });

  it('9. 평가 기록을 지우고, 사전규격은 throw 없이 성공한다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    await new EvalStore(mem).save({
      schemaVersion: 1, noticeId: A, noticeNo: A.slice(0, 13), round: '000', evalNo: '1', title: 't', orgName: 'o', evalKindName: null, techMethodName: null,
      techWeight: null, excludeBestWorst: null, status: 'final', evaluatedAt: null, bidders: [], judges: [], items: [], scores: [], official: null,
      warnings: [], collectedAt: NOW.toISOString(), firstCollectedAt: NOW.toISOString(),
    } as EvalRecord);
    const pre = samplePrespecNotice();
    await new NoticeStore(mem).saveNotice(pre);
    const r = await deleteNotices([A, pre.id], deps(mem));
    expect(r.deleted).toEqual([A, pre.id]);
    expect(r.failed).toEqual([]);
    expect((await new EvalStore(mem).loadIndex()).entries).toEqual([]);
    expect(mem.files.has(`evaluations/${A}.json`)).toBe(false);
  });

  it('10. results/follows에서 해당 id만 제거하고 남은 팔로우의 nextCheckAt을 돌려준다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    await addNotice(mem, B);
    const re = (id: string, next: string) => ({ noticeId: id, status: 'waiting', startAt: '', nextCheckAt: next, attempts: 0 });
    const fe = (id: string) => ({ noticeId: id, followedAt: '', target: 'final', notified: {} });
    mem.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [A]: re(A, '2026-10-22T00:00:00.000Z'), [B]: re(B, '2026-10-23T00:00:00.000Z') } }));
    mem.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [A]: fe(A), [B]: fe(B) } }));
    const r1 = await deleteNotices([A], deps(mem));
    expect(r1.nextFollowCheckAt).toBe('2026-10-23T00:00:00.000Z');
    expect(Object.keys(json<{ entries: object }>(mem, 'results.json').entries)).toEqual([B]);
    expect(Object.keys(json<{ entries: object }>(mem, 'follows.json').entries)).toEqual([B]);
    const r2 = await deleteNotices([B], deps(mem));
    expect(r2.nextFollowCheckAt).toBeNull();
  });

  it('11. RFP 비교 세션은 이 공고가 prev/next인 것만 지운다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const svc = createRfpService({ store: mem, parsers: {} as never, now: () => NOW });
    const ref = (noticeId: string): RfpDocRef => ({ kind: 'notice', noticeId, attachmentId: 'a1' });
    const draft = (prev: RfpDocRef, next: RfpDocRef): RfpCompareSession => ({
      schemaVersion: 1, id: '', createdAt: '', updatedAt: '', prev: { ref: prev, title: 'p' }, next: { ref: next, title: 'n' }, overrides: [], reviewed: [],
    });
    const s1 = await svc.saveCompare(draft(ref(A), ref(B)));
    const s2 = await svc.saveCompare(draft(ref(B), ref(A)));
    const s3 = await svc.saveCompare(draft(ref(B), ref(C)));
    const r = await deleteNotices([A], deps(mem, { deleteCompares: (id) => svc.deleteComparesForNotice(id) }));
    expect(r.deleted).toEqual([A]);
    expect(await svc.getCompare(s1.id)).toBeNull();
    expect(await svc.getCompare(s2.id)).toBeNull();
    expect(await svc.getCompare(s3.id)).not.toBeNull();
    expect(svc.isNoticeBusy(A)).toBe(false);
  });

  it('12. 폴더 삭제가 한 번 실패하면 failed, index 항목이 남고 재호출로 정리된다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const orig = mem.remove.bind(mem);
    const spy = vi.spyOn(mem, 'remove').mockImplementationOnce(async () => { throw new Error('boom'); });
    const r1 = await deleteNotices([A], deps(mem));
    expect(r1.deleted).toEqual([]);
    expect(r1.failed).toHaveLength(1);
    expect(r1.failed[0]!.code).toBe('DELETE_FAILED');
    expect(indexIds(mem)).toEqual([A]);
    spy.mockImplementation(orig);
    const r2 = await deleteNotices([A], deps(mem));
    expect(r2.deleted).toEqual([A]);
    expect(indexIds(mem)).toEqual([]);
    expect(noticeFiles(mem)).toEqual([]);
  });

  it('13. 폴더 없이 index 항목만 있어도 성공하고 항목을 제거한다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    for (const k of noticeFiles(mem)) if (!k.endsWith('index.json')) mem.files.delete(k);
    const r = await deleteNotices([A], deps(mem));
    expect(r.deleted).toEqual([A]);
    expect(indexIds(mem)).toEqual([]);
  });

  it('14. list가 NEEDS_FS_PERMISSION이면 전체 throw', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    mem.list = async () => { throw Object.assign(new Error('perm'), { code: 'NEEDS_FS_PERMISSION' }); };
    await expect(deleteNotices([A], deps(mem))).rejects.toMatchObject({ code: 'NEEDS_FS_PERMISSION' });
  });

  it('15. 다른 항목의 supersededBy가 삭제한 id면 제거된다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    await addNotice(mem, B);
    const idx = json<IndexFile>(mem, 'index.json');
    idx.notices.find((e) => e.noticeId === B)!.supersededBy = A;
    mem.files.set('index.json', JSON.stringify(idx));
    await deleteNotices([A], deps(mem));
    const left = json<IndexFile>(mem, 'index.json').notices;
    expect(left.map((e) => e.noticeId)).toEqual([B]);
    expect(left[0]!.supersededBy).toBeUndefined();
  });

  it('16. 빈 배열·비문자열은 INVALID_VALUE, 중복 id는 1회만 처리', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    await expect(deleteNotices([], deps(mem))).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(deleteNotices([1 as unknown as string], deps(mem))).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(deleteNotices([''], deps(mem))).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    const begin = vi.fn();
    const r = await deleteNotices([A, A], deps(mem, { mark: { begin, end: () => undefined } }));
    expect(r.deleted).toEqual([A]);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  async function halfDeleted() {
    const mem = new MemoryStore();
    const n = await addNotice(mem, A);
    await mem.writeText(sentPath(n.folder), JSON.stringify([rec('r1', A), rec('r2', A)]));
    // notice.json을 맨 뒤로 보내 mail-sent.json이 먼저 지워진 뒤 notice.json 삭제에서 실패하게 한다.
    const nj = `${n.folder}/notice.json`;
    const v = mem.files.get(nj)!;
    mem.files.delete(nj); mem.files.set(nj, v);
    const orig = mem.remove.bind(mem);
    let failed = false;
    const spy = vi.spyOn(mem, 'remove').mockImplementation(async (path: string) => {
      if (!failed && path.endsWith('/notice.json')) { failed = true; throw new Error('boom'); }
      return orig(path);
    });
    const r = await deleteNotices([A], deps(mem));
    spy.mockRestore();
    return { mem, n, r };
  }

  it('A. 재시도해도 보관본 records 2건이 유지되고 sent index에 noticeDeleted 2건', async () => {
    const { mem, n, r } = await halfDeleted();
    expect(r.failed).toHaveLength(1);
    expect(mem.files.has(sentPath(n.folder))).toBe(false);
    expect(mem.files.has(`${n.folder}/notice.json`)).toBe(true);
    const r2 = await deleteNotices([A], deps(mem));
    expect(r2.deleted).toEqual([A]);
    expect(json<SentArchiveFile>(mem, sentArchivePath(A)).records).toHaveLength(2);
    const idx = await new SentStore(mem).loadIndex();
    expect(idx.entries.filter((e) => e.noticeDeleted === true)).toHaveLength(2);
  });

  it('B. 절반 삭제 상태에서 sent index를 재생성하면 보관본 2건을 쓴다', async () => {
    const { mem } = await halfDeleted();
    mem.files.delete(SENT_INDEX_PATH);
    const idx = await new SentStore(mem).loadIndex();
    expect(idx.entries.filter((e) => e.noticeId === A).map((e) => e.id).sort()).toEqual(['r1', 'r2']);
  });

  it('C. list가 NotFoundError가 아닌 오류를 던지면 failed 1건이고 index entry가 남는다', async () => {
    const mem = new MemoryStore();
    await addNotice(mem, A);
    const orig = mem.list.bind(mem);
    mem.list = async (path: string) => {
      if (path.startsWith('notices/')) throw Object.assign(new Error('bad'), { name: 'InvalidStateError' });
      return orig(path);
    };
    const r = await deleteNotices([A], deps(mem));
    expect(r.deleted).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(indexIds(mem)).toEqual([A]);
  });
});
