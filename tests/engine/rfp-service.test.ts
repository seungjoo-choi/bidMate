// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noticeCacheName } from '../../src/engine/rfp/rfp-store';
import type { RfpCompareSession, RequirementSet } from '../../src/core/types/rfp';
import { createParserRegistry } from '../../src/engine/parsers/registry';
import type { DocFormat, ParserRegistry } from '../../src/engine/parsers/types';
import { createRfpService } from '../../src/engine/rfp/rfp-service';
import { MemoryStore } from '../helpers/memory-store';

const DOCS = 'tests/fixtures/docs';
const HWP_NAME = '(붙임2) 제안요청서(전자출하시스템 활성화 및 유지보수 사업).hwp';
const HWPX_NAME = '제안요청서(축산물원패스 기능 고도화 사업).hwpx';
const hwp = new Uint8Array(readFileSync(`${DOCS}/R26BK01631407/${HWP_NAME}`));
const hwpx = new Uint8Array(readFileSync(`${DOCS}/R26BK01592099/${HWPX_NAME}`));
const b64Of = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

const NOTICE_ID = 'N-1';
const FOLDER = 'notices/2026/N-1_test';
const ATT_PATH = `${FOLDER}/attachments/2_rfp.hwp`;

let store: MemoryStore;
let parseCount: number;
let svc: ReturnType<typeof createRfpService>;

function countingRegistry(): ParserRegistry {
  const base = createParserRegistry({ pdf: { cMapUrl: '', standardFontDataUrl: '' }, parseXml: (x) => new DOMParser().parseFromString(x, 'application/xml') });
  return {
    detect: base.detect,
    get: (f: DocFormat) => {
      const p = base.get(f);
      return { ...p, parse: (input) => { parseCount++; return p.parse(input); } };
    },
  };
}

function seedNotice() {
  const att = (id: string, index: number, name: string, saved: string, size: number, docKind: string) =>
    ({ id, index, originalName: name, savedName: saved, url: '', expectedSize: size, savedSize: size, status: 'saved', attempts: 1, docKind });
  const notice = {
    id: NOTICE_ID, folder: FOLDER, basic: {},
    attachments: [att('a0', 0, '공고문.hwp', '0_notice.hwp', 10, 'notice'), att('a1', 2, HWP_NAME, '2_rfp.hwp', hwp.length, 'rfp')],
  };
  store.files.set(`${FOLDER}/notice.json`, JSON.stringify(notice));
  store.files.set(ATT_PATH, hwp);
  store.files.set(`${FOLDER}/attachments/0_notice.hwp`, new Uint8Array(10));
  store.files.set('index.json', JSON.stringify({
    schemaVersion: 1, indexVersion: 3, generatedAt: '2026-10-21T00:00:00.000Z',
    notices: [{ noticeId: NOTICE_ID, folder: FOLDER }],
  }));
}

const noticeRef = { kind: 'notice' as const, noticeId: NOTICE_ID, attachmentId: 'a1' };

beforeEach(() => {
  store = new MemoryStore();
  parseCount = 0;
  svc = createRfpService({ store, parsers: countingRegistry(), now: () => new Date('2026-10-21T01:02:03.000Z') });
  seedNotice();
});

describe('extract (수집 공고 첨부)', () => {
  it('요구사항을 추출하고 캐시 JSON·텍스트를 만든다', async () => {
    const set = await svc.extract(noticeRef);
    expect(set.items.length).toBeGreaterThanOrEqual(90);
    expect(store.files.has(`${FOLDER}/rfp/a1.json`)).toBe(true);
    expect(store.files.has(`${FOLDER}/rfp/a1.txt`)).toBe(true);
    expect(set.source.textPath).toBe(`${FOLDER}/rfp/a1.txt`);
  });

  it('두 번째 호출은 캐시를 쓰고, force면 다시 파싱한다', async () => {
    await svc.extract(noticeRef);
    expect(parseCount).toBe(1);
    await svc.extract(noticeRef);
    expect(parseCount).toBe(1);
    await svc.extract(noticeRef, true);
    expect(parseCount).toBe(2);
  });

  it('원본 크기가 달라지면 다시 파싱한다', async () => {
    await svc.extract(noticeRef);
    const path = `${FOLDER}/rfp/a1.json`;
    const cached = JSON.parse(store.files.get(path) as string) as RequirementSet;
    cached.source.size += 1;
    store.files.set(path, JSON.stringify(cached));
    await svc.extract(noticeRef);
    expect(parseCount).toBe(2);
  });

  it('같은 문서 동시 요청은 파싱 1회', async () => {
    const [a, b] = await Promise.all([svc.extract(noticeRef), svc.extract(noticeRef)]);
    expect(parseCount).toBe(1);
    expect(a.items.length).toBe(b.items.length);
  });

  it('text는 저장된 텍스트를 돌려준다', async () => {
    const { text } = await svc.text(noticeRef);
    expect(text.length).toBeGreaterThan(1000);
  });
});

describe('listDocs', () => {
  it('rfp 첨부가 맨 앞이고, 추출 후 ready가 된다', async () => {
    const before = await svc.listDocs(NOTICE_ID);
    expect(before.map((d) => d.ref.attachmentId)).toEqual(['a1', 'a0']);
    expect(before[0]!.docKind).toBe('rfp');
    expect(before[0]!.status).toBe('parse_needed');
    await svc.extract(noticeRef);
    const after = await svc.listDocs(NOTICE_ID);
    expect(after[0]!.status).toBe('ready');
    expect(after[0]!.itemCount).toBeGreaterThanOrEqual(90);
    expect(after[1]!.status).toBe('parse_needed');
  });
});

describe('upload', () => {
  it('업로드 → 목록 → 이름 변경 → 삭제', async () => {
    const { uploadId, set } = await svc.upload({ name: HWPX_NAME, size: hwpx.length, b64: b64Of(hwpx) });
    expect(uploadId).toMatch(/^u_\d{14}_[a-z0-9]{4}$/);
    expect(set.items.length).toBeGreaterThan(0);
    expect(set.ref).toEqual({ kind: 'upload', uploadId });
    const list = await svc.uploads();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe(HWPX_NAME);
    const renamed = await svc.renameUpload(uploadId, '  작년 제안요청서  ');
    expect(renamed.label).toBe('작년 제안요청서');
    expect((await svc.renameUpload(uploadId, '')).label).toBeUndefined();
    await svc.deleteUpload(uploadId);
    expect(await svc.uploads()).toEqual([]);
  });

  it('지원하지 않는 확장자를 거부한다', async () => {
    await expect(svc.upload({ name: 'a.txt', size: 3, b64: 'YWJj' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('크기 초과를 거부한다', async () => {
    const big = b64Of(new Uint8Array(21 * 1024 * 1024));
    await expect(svc.upload({ name: 'a.hwp', size: 21 * 1024 * 1024, b64: big })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('파싱에 실패하면 업로드 폴더를 지우고 에러를 던진다', async () => {
    await expect(svc.upload({ name: 'a.pdf', size: 3, b64: 'YWJj' })).rejects.toBeTruthy();
    expect(await svc.uploads()).toEqual([]);
    expect([...store.files.keys()].filter((k) => k.startsWith('rfp/uploads/'))).toEqual([]);
  });
});

describe('id 검증', () => {
  it('잘못된 uploadId/compareId를 거부한다', async () => {
    await expect(svc.deleteUpload('../x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(svc.renameUpload('../x', 'a')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(svc.extract({ kind: 'upload', uploadId: '../x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(svc.getCompare('../x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(svc.deleteCompare('../x')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(svc.saveCompare({ id: '../x' } as RfpCompareSession)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('compare 세션', () => {
  const draft = (over: Partial<RfpCompareSession> = {}): RfpCompareSession => ({
    schemaVersion: 1, id: '', createdAt: '', updatedAt: '',
    prev: { ref: noticeRef, title: '이전' }, next: { ref: noticeRef, title: '이후' },
    overrides: [], reviewed: ['a|b'], ...over,
  });

  it('저장(새 id)·목록·조회·삭제', async () => {
    const saved = await svc.saveCompare(draft());
    expect(saved.id).toMatch(/^c_\d{14}_[a-z0-9]{4}$/);
    expect(saved.createdAt).toBe('2026-10-21T01:02:03.000Z');
    const list = await svc.listCompares();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: saved.id, prevTitle: '이전', nextTitle: '이후', reviewedCount: 1 });
    expect((await svc.getCompare(saved.id))?.id).toBe(saved.id);
    await svc.deleteCompare(saved.id);
    expect(await svc.getCompare(saved.id)).toBeNull();
    expect(await svc.listCompares()).toEqual([]);
  });

  it('재저장하면 createdAt은 유지되고 updatedAt이 갱신된다', async () => {
    const first = await svc.saveCompare(draft());
    const later = createRfpService({ store, parsers: countingRegistry(), now: () => new Date('2026-10-22T00:00:00.000Z') });
    const second = await later.saveCompare({ ...first, createdAt: 'x', reviewed: [] });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe('2026-10-22T00:00:00.000Z');
  });

  it('너무 큰 세션을 거부한다', async () => {
    await expect(svc.saveCompare(draft({ reviewed: Array.from({ length: 5001 }, (_, i) => `k${i}`) }))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(svc.saveCompare(draft({ prev: { ref: noticeRef, title: 'x'.repeat(1_000_001) } }))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('새 id가 이미 있으면 다시 만든다', async () => {
    store.files.set('rfp/compares/c_20261021010203_aaaa.json', '{}');
    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 4; i++) spy.mockReturnValueOnce(0); // 첫 id는 'aaaa'
    try {
      const saved = await svc.saveCompare(draft());
      expect(saved.id).not.toBe('c_20261021010203_aaaa');
      expect(saved.id).toMatch(/^c_\d{14}_[a-z0-9]{4}$/);
      expect(store.files.get('rfp/compares/c_20261021010203_aaaa.json')).toBe('{}');
    } finally { spy.mockRestore(); }
  });
});

describe('캐시 이름·진행 중 요청·유령 폴더', () => {
  it('zip 안의 같은 파일명이 다른 폴더에 있어도 캐시 이름이 다르다', () => {
    const a = noticeCacheName({ kind: 'notice', noticeId: 'n', attachmentId: 'a1', innerPath: '1차/제안요청서.hwp' });
    const b = noticeCacheName({ kind: 'notice', noticeId: 'n', attachmentId: 'a1', innerPath: '2차/제안요청서.hwp' });
    expect(a).not.toBe(b);
  });

  it('진행 중 extract 뒤의 force 요청은 공유되지 않고 다시 파싱한다', async () => {
    await Promise.all([svc.extract(noticeRef), svc.extract(noticeRef, true)]);
    expect(parseCount).toBe(2);
  });

  it('원본이 없는 업로드 폴더는 목록에서 제외한다', async () => {
    store.files.set('rfp/uploads/u_20261021010203_abcd/requirements.json', '{}');
    expect(await svc.uploads()).toEqual([]);
  });
});
