import { describe, expect, it, vi } from 'vitest';
import { loadRules } from '../../src/core/extraction/rules/load';
import { defaultSettings } from '../../src/core/model/default-settings';
import type { Extraction } from '../../src/core/types/extraction';
import type { Job } from '../../src/core/types/job';
import type { Notice } from '../../src/core/types/notice';
import { assertExtensionSender, assertRetryAllowed } from '../../src/background/job-coordinator';
import { runExtractJob } from '../../src/engine/jobs/extract-job';
import { JobRegistry } from '../../src/engine/jobs/job-registry';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { editExtraction, getNotice, readExtractionText } from '../../src/engine/notices/notice-api';
import { docOf, fakeParsers, readJsonFile, runCollect } from '../helpers/extract-harness';
import type { MemoryStore } from '../helpers/memory-store';

const parsers = fakeParsers(async () => docOf('차등점수제 : 미적용'));
const files = { '1. 입찰공고문.hwp': 'x' };

const extractJob = (noticeId: string): Job => ({
  id: 'e1', type: 'extract', noticeId, status: 'running', steps: [{ id: 'extract', status: 'pending' }],
  attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
});
const reExtract = (store: MemoryStore, noticeId: string) =>
  runExtractJob({ job: extractJob(noticeId), settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers, rules: loadRules(), emit: () => undefined });

describe('사전규격 추출 거부', () => {
  it('prespec notice는 EXTRACT_NOT_APPLICABLE로 실패(재시도 불가)', async () => {
    const { store } = await runCollect({ files, parsers });
    const key = [...store.files.keys()].find((k) => k.endsWith('/notice.json'))!;
    const n = JSON.parse(await store.readText(key)) as Notice;
    n.ref = { ...n.ref, kind: 'prespec' };
    await store.writeText(key, JSON.stringify(n));
    const r = await reExtract(store, n.id);
    expect(r.status).toBe('failed');
    expect(r.error).toMatchObject({ code: 'EXTRACT_NOT_APPLICABLE', retryable: false });
  });
});

describe('수정 보존', () => {
  it('user_edited 필드와 userEdited item이 재추출 뒤에도 유지된다', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    await editExtraction(store, { noticeId: id, key: "differentialScoring", value: true, note: "수동" });
    const mid = readJsonFile<Extraction>(store, '/extraction.json');
    expect(mid.items.differentialScoring.userEdited?.value).toBe(true);

    const r = await reExtract(store, id);
    expect(r.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.items.differentialScoring.userEdited).toMatchObject({ value: true, note: '수동' });
    expect(x.items.differentialScoring.candidates?.[0]?.value).toBe(false); // 새 자동 결과는 후보로
    const n = readJsonFile<Notice>(store, '/notice.json');
    expect(n.evaluation.differentialScoring).toMatchObject({ value: true, status: 'user_edited' });
  });

  it('수정 해제(null)는 자동 결과로 되돌린다', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    await editExtraction(store, { noticeId: id, key: 'differentialScoring', value: true });
    const { notice, extraction } = await editExtraction(store, { noticeId: id, key: 'differentialScoring', value: null });
    expect(extraction.items.differentialScoring.userEdited).toBeUndefined();
    expect(notice.evaluation.differentialScoring).toMatchObject({ value: false, status: 'verified' });
  });
});

describe('발신자 제한', () => {
  const ID = 'abcdefghijklmnop';
  const g2b = { id: ID, url: 'https://www.g2b.go.kr/', tab: { id: 3 } as chrome.tabs.Tab };
  const ext = { id: ID, url: `chrome-extension://${ID}/dashboard.html` };
  it('g2b 발신의 extract 잡 요청은 SENDER_FORBIDDEN, 확장 페이지는 허용', async () => {
    vi.stubGlobal('chrome', { runtime: { id: ID } });
    try {
      await expect(assertRetryAllowed({ type: 'extract', noticeId: 'n' }, g2b)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
      await expect(assertRetryAllowed({ type: 'extract', noticeId: 'n' }, ext)).resolves.toBeUndefined();
      expect(() => assertExtensionSender(g2b)).toThrow(expect.objectContaining({ code: 'SENDER_FORBIDDEN' }));
      expect(() => assertExtensionSender(ext)).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('extraction/text 경로 검증', () => {
  it('../ 탈출과 text 폴더 밖은 거부, 안쪽은 읽는다', async () => {
    const { store } = await runCollect({ files, parsers });
    const n = readJsonFile<Notice>(store, '/notice.json');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    await expect(readExtractionText(store, { noticeId: n.id, textPath: `${n.folder}/source/text/../../notice.json` })).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(readExtractionText(store, { noticeId: n.id, textPath: '../x.txt' })).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(readExtractionText(store, { noticeId: n.id, textPath: `${n.folder}/notice.json` })).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    const ok = await readExtractionText(store, { noticeId: n.id, textPath: x.files[0]!.textPath! });
    expect(ok.text).toContain('차등점수제');
  });
});

describe('edit 보호', () => {
  it('같은 공고의 잡이 실행 중이면 JOB_ALREADY_RUNNING', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    const reg = new JobRegistry();
    expect(reg.tryRegister({ id: 'r1', attempt: 1, type: 'collect', ref: { noticeNo: 'R26BK01722175', origin: 'g2b' } }).ok).toBe(true);
    const isBusy = (noticeId: string) => reg.findConflict({ type: 'extract', noticeId }) !== undefined;
    await expect(editExtraction(store, { noticeId: id, key: 'differentialScoring', value: true }, { isBusy })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    reg.release('r1');
    await expect(editExtraction(store, { noticeId: id, key: 'differentialScoring', value: true }, { isBusy })).resolves.toBeTruthy();
  });

  it('잡 저장 직전에 디스크에 생긴 수정은 저장 결과에 보존된다', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    let edited = false;
    const racing = fakeParsers(async () => {
      if (!edited) { edited = true; await editExtraction(store, { noticeId: id, key: 'performanceScore', value: 9 }); }
      return docOf('차등점수제 : 미적용');
    });
    const r = await runExtractJob({ job: extractJob(id), settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers: racing, rules: loadRules(), emit: () => undefined });
    expect(r.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.items.performanceScore.userEdited?.value).toBe(9);
    expect(readJsonFile<Notice>(store, '/notice.json').evaluation.performanceScore).toMatchObject({ value: 9, status: 'user_edited' });
  });
});

describe('edit 입력 검증', () => {
  it('__proto__/constructor 키는 INVALID_KEY, 프로토타입 오염 없음', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    for (const key of ['__proto__', 'constructor']) {
      await expect(editExtraction(store, { noticeId: id, key: key as never, value: { x: 1 } })).rejects.toMatchObject({ code: 'INVALID_KEY' });
    }
    expect((Object.prototype as { userEdited?: unknown }).userEdited).toBeUndefined();
  });
  it('타입이 틀린 value/note는 INVALID_VALUE', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    const bad: Array<[never, unknown]> = [
      ['credibilityScore' as never, '4'], ['credibilityScore' as never, 1001], ['performancePeriod' as never, '5'],
      ['performanceMinAmount' as never, 1.5], ['performanceCondition' as never, 'x'.repeat(2001)], ['differentialScoring' as never, 'false'],
    ];
    for (const [key, value] of bad) await expect(editExtraction(store, { noticeId: id, key, value })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(editExtraction(store, { noticeId: id, key: 'credibilityScore', value: 4, note: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });
});

describe('saveExtractionLatest 사용자 수정 동기화', () => {
  it('낡은 notice를 들고 있어도 디스크 userEdited가 notice 필드에 반영된다', async () => {
    const { store } = await runCollect({ files, parsers });
    const ns = new NoticeStore(store);
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    const stale = (await ns.loadNotice(id))!;
    const x = (await ns.loadExtraction(id))!;
    await editExtraction(store, { noticeId: id, key: 'performanceScore', value: 9 });
    expect(stale.evaluation.performanceScore.status).not.toBe('user_edited');
    await ns.saveExtractionLatest(stale, x);
    expect(readJsonFile<Notice>(store, '/notice.json').evaluation.performanceScore).toMatchObject({ value: 9, status: 'user_edited' });
  });
});

describe('옛 스키마 extraction 읽기 보정', () => {
  const oldSchema = async (parsersForCollect = parsers) => {
    const { store } = await runCollect({ files, parsers: parsersForCollect });
    const key = [...store.files.keys()].find((k) => k.endsWith('/extraction.json'))!;
    const x = readJsonFile<Extraction>(store, '/extraction.json') as unknown as { schemaVersion: number; items: Record<string, unknown> };
    delete x.items.managementScore;
    x.schemaVersion = 1;
    x.items.credibilityScore = { value: 4, status: 'verified', userEdited: { value: 4, editedAt: 't' } };
    await store.writeText(key, JSON.stringify(x));
    return { store, id: readJsonFile<Notice>(store, '/notice.json').id };
  };

  it('getNotice는 not_run을 채우고 editExtraction은 저장 시 schemaVersion 2, userEdited 보존', async () => {
    const { store, id } = await oldSchema();
    const got = await getNotice(store, id);
    expect(got!.extraction!.items.managementScore).toEqual({ value: null, status: 'not_run' });
    await expect(editExtraction(store, { noticeId: id, key: 'managementScore', value: 10 })).resolves.toBeTruthy();
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.schemaVersion).toBe(2);
    expect(x.items.managementScore.userEdited?.value).toBe(10);
    expect(x.items.credibilityScore.userEdited?.value).toBe(4);
  });

  it('옛 데이터를 prior로 재추출하면 경고, 새 스키마 prior는 경고 없음', async () => {
    const mgmt = fakeParsers(async () => docOf('경영상태 평가 10점'));
    const { store, id } = await oldSchema();
    const r = await runExtractJob({ job: extractJob(id), settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers: mgmt, rules: loadRules(), emit: () => undefined });
    expect(r.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.warnings.some((w) => w.includes('이전 버전에서 직접 수정한 대외신인도'))).toBe(true);
    expect(x.items.credibilityScore.userEdited?.value).toBe(4);
    expect(x.items.managementScore).toMatchObject({ value: 10, status: 'verified' });

    const r2 = await runExtractJob({ job: extractJob(id), settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers: mgmt, rules: loadRules(), emit: () => undefined });
    expect(r2.status).toBe('completed');
    const x2 = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x2.warnings.some((w) => w.includes('이전 버전에서 직접 수정한 대외신인도'))).toBe(false);
  });

  it('옛 데이터에서 managementScore를 이미 직접 수정했으면 대외신인도 경고가 없다', async () => {
    const mgmt = fakeParsers(async () => docOf('경영상태 평가 10점'));
    const { store, id } = await oldSchema();
    const key = [...store.files.keys()].find((k) => k.endsWith('/extraction.json'))!;
    const x = readJsonFile<Extraction>(store, '/extraction.json') as unknown as { items: Record<string, unknown> };
    x.items.managementScore = { value: null, status: 'not_run', userEdited: { value: 10, editedAt: 't' } };
    await store.writeText(key, JSON.stringify(x));
    const r = await runExtractJob({ job: extractJob(id), settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers: mgmt, rules: loadRules(), emit: () => undefined });
    expect(r.status).toBe('completed');
    const out = readJsonFile<Extraction>(store, '/extraction.json');
    expect(out.warnings.some((w) => w.includes('이전 버전에서 직접 수정한 대외신인도'))).toBe(false);
  });

  it('managementScore 범위/타입 오류는 INVALID_VALUE', async () => {
    const { store } = await runCollect({ files, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    await expect(editExtraction(store, { noticeId: id, key: 'managementScore', value: 1001 })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(editExtraction(store, { noticeId: id, key: 'managementScore', value: '4' as never })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });
});

describe('파일 이름 태그(기본 켜짐)', () => {
  it('첨부 저장 파일명과 추출 텍스트 파일명 맨 앞에 태그가 붙는다', async () => {
    const { store } = await runCollect({ files, parsers });
    const n = readJsonFile<Notice>(store, '/notice.json');
    const a = n.attachments[0]!;
    expect(a).toMatchObject({ originalName: '1. 입찰공고문.hwp', savedName: '[대외비 2군] 1. 입찰공고문.hwp', namePrefix: '[대외비 2군]' });
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    const tp = x.files.find((f) => f.textPath)?.textPath ?? '';
    expect(tp.slice(tp.lastIndexOf('/') + 1)).toBe('[대외비 2군] 0_1. 입찰공고문.hwp.txt');
  });
});
