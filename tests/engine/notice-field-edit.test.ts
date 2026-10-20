import { describe, expect, it } from 'vitest';
import { pendingKeys } from '../../src/core/extraction/review-count';
import { renderMail } from '../../src/core/templates/render';
import type { Extraction } from '../../src/core/types/extraction';
import type { IndexFile } from '../../src/core/types/index-file';
import type { Notice } from '../../src/core/types/notice';
import type { Template } from '../../src/core/types/template';
import { editNoticeField } from '../../src/engine/notices/notice-api';
import { docOf, fakeParsers, mkCollectJob, readJsonFile, runCollect } from '../helpers/extract-harness';
import type { MemoryStore } from '../helpers/memory-store';

const files = { '1. 입찰공고문.hwp': 'x' };
const parsers = fakeParsers(async () => docOf('사업기간: 계약일로부터 12개월', '차등점수제 : 미적용'));
const nopeParsers = fakeParsers(async () => docOf('내용 없음'));
const edit = (store: MemoryStore, key: string, value: unknown, extra: { raw?: string; note?: string } = {}, opts = {}) =>
  editNoticeField(store, { noticeId: readJsonFile<Notice>(store, '/notice.json').id, key, value, ...extra }, opts);
const notice = (store: MemoryStore) => readJsonFile<Notice>(store, '/notice.json');
const errCode = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { code?: string }).code ?? 'NOCODE'; } };
const reextractJob = (n: Notice) => mkCollectJob({
  attempt: 2, noticeId: n.id,
  steps: [
    { id: 'fetch_basic', status: 'done' }, { id: 'download_attachments', status: 'done' },
    { id: 'extract', status: 'pending' }, { id: 'fetch_html', status: 'pending' },
  ],
});

describe('editNoticeField', () => {
  it('projectPeriod를 고치면 user_edited + before가 저장된다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    expect(notice(store).basic.projectPeriod.status).toBe('missing');
    await edit(store, 'projectPeriod', '계약일로부터 90일');
    expect(notice(store).basic.projectPeriod).toMatchObject({
      value: '계약일로부터 90일', status: 'user_edited', source: { kind: 'user' }, userEdit: { before: { status: 'missing' } },
    });
  });

  it('null이면 before가 복원되고, 수정되지 않은 필드는 아무것도 바뀌지 않는다', async () => {
    const { store } = await runCollect({ files, parsers });
    const orig = notice(store).basic.projectPeriod;
    await edit(store, 'projectPeriod', '직접 입력');
    await edit(store, 'projectPeriod', null);
    expect(notice(store).basic.projectPeriod).toEqual(orig);
    const snapshot = JSON.stringify(notice(store));
    const r = await edit(store, 'budgetAmount', null);
    expect(JSON.stringify(notice(store))).toBe(snapshot);
    expect(r.notice.basic.budgetAmount.status).not.toBe('user_edited');
  });

  it('재수집해도 사용자 값은 유지되고 before는 이번 수집 값으로 갱신된다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    const apiTitle = notice(store).basic.title.value;
    await edit(store, 'title', '내 제목');
    await runCollect({ files, parsers: nopeParsers, store });
    const t = notice(store).basic.title;
    expect(t).toMatchObject({ value: '내 제목', status: 'user_edited' });
    expect(t.userEdit?.before).toMatchObject({ value: apiTitle, status: 'verified' });
  });

  it('재추출해도 사용자 값이 유지된다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    await edit(store, 'projectPeriod', '내가 쓴 기간');
    await runCollect({ files, parsers, store, job: reextractJob(notice(store)) });
    expect(notice(store).basic.projectPeriod).toMatchObject({ value: '내가 쓴 기간', status: 'user_edited' });
  });

  it('ExtractionKey는 extraction이 있으면 userEdited, 없으면 notice만 user_edited', async () => {
    const { store } = await runCollect({ files, parsers });
    const r = await edit(store, 'performanceScore', 7);
    expect(r.extraction?.items.performanceScore.userEdited).toMatchObject({ value: 7 });
    expect(readJsonFile<Extraction>(store, '/extraction.json').items.performanceScore.userEdited).toBeDefined();
    store.files.delete([...store.files.keys()].find((k) => k.endsWith('/extraction.json'))!);
    const r2 = await edit(store, 'performanceScore', 8);
    expect(r2.extraction).toBeNull();
    expect(notice(store).evaluation.performanceScore).toMatchObject({ value: 8, status: 'user_edited' });
  });

  it('extraction 없이 notice에만 고친 평가 값은 첫 추출 때 userEdited로 옮겨 심어진다', async () => {
    const { store } = await runCollect({ files, parsers });
    store.files.delete([...store.files.keys()].find((k) => k.endsWith('/extraction.json'))!);
    await edit(store, 'performanceScore', 9);
    expect(notice(store).evaluation.performanceScore).toMatchObject({ value: 9, status: 'user_edited' });
    await runCollect({ files, parsers, store, job: reextractJob(notice(store)) });
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.items.performanceScore.userEdited?.value).toBe(9);
    expect(notice(store).evaluation.performanceScore).toMatchObject({ value: 9, status: 'user_edited' });
    expect(pendingKeys(x.items)).not.toContain('performanceScore');
  });

  it('잘못된 키/값/note는 거부한다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    for (const k of ['noticeNo', 'round', 'foo', 'custom.']) expect(await errCode(edit(store, k, 'x'))).toBe('INVALID_KEY');
    expect(await errCode(edit(store, 'bidCloseAt', '내일'))).toBe('INVALID_VALUE');
    expect(await errCode(edit(store, 'budgetAmount', -1))).toBe('INVALID_VALUE');
    expect(await errCode(edit(store, 'title', 'x', { note: 'n'.repeat(501) }))).toBe('INVALID_VALUE');
  });

  it('isBusy면 JOB_ALREADY_RUNNING이고 파일은 바뀌지 않는다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    const snapshot = JSON.stringify(notice(store));
    expect(await errCode(edit(store, 'title', '새 제목', {}, { isBusy: () => true }))).toBe('JOB_ALREADY_RUNNING');
    expect(JSON.stringify(notice(store))).toBe(snapshot);
  });

  it('custom 필드를 만들고 되돌리면 키가 삭제되며, 메일 렌더에서 unresolved에서 빠진다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    const tpl: Template = { id: 't', name: 't', isDefault: false, subject: '{custom.담당부서}', greeting: '', closing: '', layout: 'table', sections: [], updatedAt: 'x' };
    expect(renderMail(tpl, notice(store)).unresolved.map((u) => u.name)).toContain('custom.담당부서');
    await edit(store, 'custom.담당부서', '정보화팀');
    expect(notice(store).customFields['담당부서']).toMatchObject({ value: '정보화팀', status: 'user_edited' });
    const r = renderMail(tpl, notice(store));
    expect(r.subject).toBe('정보화팀');
    expect(r.unresolved.map((u) => u.name)).not.toContain('custom.담당부서');
    await edit(store, 'custom.담당부서', null);
    expect(Object.hasOwn(notice(store).customFields, '담당부서')).toBe(false);
  });

  it('title을 고치면 index entry.title이 갱신되고 folder는 그대로다', async () => {
    const { store } = await runCollect({ files, parsers: nopeParsers });
    const folder = notice(store).folder;
    await edit(store, 'title', '바뀐 제목');
    const idx = JSON.parse(store.files.get('index.json') as string) as IndexFile;
    expect(idx.notices[0]).toMatchObject({ title: '바뀐 제목', folder });
    expect(notice(store).folder).toBe(folder);
  });
});
