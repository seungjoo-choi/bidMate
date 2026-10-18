import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Extraction } from '../../src/core/types/extraction';
import type { IndexFile } from '../../src/core/types/index-file';
import type { Notice } from '../../src/core/types/notice';
import { createParserRegistry } from '../../src/engine/parsers/registry';
import { docOf, fakeParsers, mkCollectJob, readJsonFile, runCollect } from '../helpers/extract-harness';

const DIR = 'tests/fixtures/docs/R26BK01722175';
const pdfEnv = { cMapUrl: 'node_modules/pdfjs-dist/cmaps/', standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' };

describe('실문서 수집 흐름', () => {
  it('f1/f2/f3/f6 수집 → extraction.json, 텍스트, 출처 document, index 갱신', async () => {
    const files = {
      '1. 입찰공고문.hwp': readFileSync(`${DIR}/1. 입찰공고문.hwp`),
      '1. 입찰공고문.pdf': readFileSync(`${DIR}/1. 입찰공고문.pdf`),
      '2. 제안요청서.hwp': readFileSync(`${DIR}/2. 제안요청서.hwp`),
      '5. (참고) 사전공고 질의답변.hwp': readFileSync(`${DIR}/5. (참고) 사전공고 질의답변.hwp`),
    };
    const { out, store } = await runCollect({ files, parsers: createParserRegistry({ pdf: pdfEnv }) });
    expect(out.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    const it = x.items;
    expect(it.managementScore).toMatchObject({ value: 4, status: 'verified' });
    expect(it.credibilityScore).toMatchObject({ value: null, status: 'needs_review', reason: 'not_found' });
    expect(it.performanceScore).toMatchObject({ value: 6, status: 'verified' });
    expect(it.performancePeriod).toMatchObject({ value: '5년', status: 'verified' });
    expect(it.performanceMinAmount).toMatchObject({ value: 500000000, status: 'verified' });
    expect(it.differentialScoring).toMatchObject({ value: false, status: 'verified' });
    expect(it.performanceCondition).toMatchObject({ status: 'verified' });
    expect(x.status).toBe('needs_review');
    expect(x.schemaVersion).toBe(2);
    // 텍스트 산출물
    const texts = [...store.files.keys()].filter((k) => k.includes('/source/text/') && k.endsWith('.txt'));
    expect(texts.length).toBe(3);
    // f2는 쌍둥이로 건너뜀
    const f2 = x.files.find((f) => f.name.endsWith('.pdf'))!;
    expect(f2).toMatchObject({ status: 'skipped', skipReason: 'duplicate' });
    // notice.evaluation 출처
    const notice = readJsonFile<Notice>(store, '/notice.json');
    for (const k of ['managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'differentialScoring'] as const) {
      expect(notice.evaluation[k].source?.kind).toBe('document');
    }
    expect(notice.evaluation.performanceCondition.status).toBe('verified');
    expect(notice.attachments.every((a) => a.docKind !== undefined)).toBe(true);
    // index
    const idx = JSON.parse(store.files.get('index.json') as string) as IndexFile;
    expect(idx.notices[0]!.extractionStatus).toBe('needs_review');
    const res = out.result!;
    expect(res.extraction).toMatchObject({ status: 'needs_review' });
    expect(res.extraction!.reviewCount).toBe(1);
  }, 60_000);
});

describe('추출 실패/재시도', () => {
  it('파서 실패 → partial + EXTRACT_FAILED, 재시도는 extract만 다시 실행(API 호출 없음)', async () => {
    let ok = false;
    const parsers = fakeParsers(async () => (ok ? docOf('차등점수제 : 미적용') : { ok: false, reason: 'corrupt', message: '깨짐' }));
    const files = { '1. 입찰공고문.hwp': 'x' };
    const first = await runCollect({ files, parsers });
    expect(first.out.status).toBe('partial');
    expect(first.out.error?.code).toBe('EXTRACT_FAILED');
    const n1 = readJsonFile<Notice>(first.store, '/notice.json');
    expect(n1.collect.errors.map((e) => e.code)).toContain('EXTRACT_FAILED');
    expect(n1.collect.errors.find((e) => e.code === 'EXTRACT_FAILED')?.retryable).toBe(true);
    expect(first.apiCalls).toBe(1);

    ok = true;
    const job = mkCollectJob({
      attempt: 2, noticeId: n1.id,
      steps: [
        { id: 'fetch_basic', status: 'done' }, { id: 'download_attachments', status: 'done' },
        { id: 'extract', status: 'pending' }, { id: 'fetch_html', status: 'pending' },
      ],
    });
    const second = await runCollect({ files, parsers, store: first.store, job });
    expect(second.apiCalls).toBe(0);
    expect(second.fetchCalls).toBe(0);
    expect(second.out.status).toBe('completed');
    expect(readJsonFile<Notice>(second.store, '/notice.json').collect.errors).toEqual([]);
    expect(readJsonFile<Extraction>(second.store, '/extraction.json').items.differentialScoring.value).toBe(false);
  });
});

describe('병합 충돌', () => {
  // 화면 파서는 differentialScoring을 해석하지 않으므로(html-parse.ts), 숫자로 해석되는 managementScore로 같은 경로를 검증한다.
  const html = (raw: string) => ({ fields: { managementScore: { raw, ref: 'x' } }, capturedAt: '2026-10-17T00:00:00Z' });
  const f3 = { '2. 제안요청서.hwp': readFileSync(`${DIR}/2. 제안요청서.hwp`) };
  const parsers = createParserRegistry({ pdf: pdfEnv });

  it('html과 문서 값이 다르면 needs_review + candidates', async () => {
    const { store } = await runCollect({ files: f3, parsers, html: html('5') });
    const f = readJsonFile<Notice>(store, '/notice.json').evaluation.managementScore;
    expect(f.status).toBe('needs_review');
    expect(f.candidates?.length).toBe(2);
  });
  it('같으면 verified, 출처는 html 유지', async () => {
    const { store } = await runCollect({ files: f3, parsers, html: html('4') });
    const f = readJsonFile<Notice>(store, '/notice.json').evaluation.managementScore;
    expect(f.status).toBe('verified');
    expect(f.value).toBe(4);
    expect(f.source?.kind).toBe('html');
  });
});

describe('취소/예산', () => {
  it('파싱 중 abort → cancelled, notice.json 저장됨', async () => {
    const ac = new AbortController();
    const parsers = fakeParsers((_n, signal) => new Promise((resolve) => {
      setTimeout(() => ac.abort(), 10);
      signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', message: '취소' }));
    }));
    const { out, store } = await runCollect({ files: { '1. 입찰공고문.hwp': 'x' }, parsers, signal: ac.signal });
    expect(out.status).toBe('cancelled');
    expect([...store.files.keys()].some((k) => k.endsWith('/notice.json'))).toBe(true);
    expect([...store.files.keys()].some((k) => k.endsWith('/extraction.json'))).toBe(false);
  });

  it('budgetMs가 작으면 뒤쪽 파일은 skipped/budget', async () => {
    const parsers = fakeParsers(async () => { await new Promise((r) => setTimeout(r, 20)); return docOf('차등점수제 : 미적용'); });
    const files = { '1. 입찰공고문.hwp': 'a', '2. 제안요청서.hwp': 'b', '3. 기타자료.hwp': 'c' };
    const { store } = await runCollect({ files, parsers, settings: { budgetMs: 1 } });
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    const byName = Object.fromEntries(x.files.map((f) => [f.name, f]));
    expect(byName['1. 입찰공고문.hwp']!.status).toBe('parsed');
    expect(byName['2. 제안요청서.hwp']).toMatchObject({ status: 'skipped', skipReason: 'budget' });
    expect(byName['3. 기타자료.hwp']).toMatchObject({ status: 'skipped', skipReason: 'budget' });
  });
});
