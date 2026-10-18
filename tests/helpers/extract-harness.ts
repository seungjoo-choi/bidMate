import servcFx from '../fixtures/g2b-servc-R26BK01722175.json';
import { loadRules } from '../../src/core/extraction/rules/load';
import { defaultSettings } from '../../src/core/model/default-settings';
import type { DocModel } from '../../src/core/doc/model';
import type { HtmlFields, Job, JobProgress } from '../../src/core/types/job';
import { runCollectJob, type CollectOutcome } from '../../src/engine/jobs/collect-job';
import type { ParserRegistry, ParseResult } from '../../src/engine/parsers/types';
import { MemoryStore } from './memory-store';

const baseItem = servcFx.response.body.items[0] as Record<string, string>;

export const mkCollectJob = (over: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', noticeId: 'R26BK01722175-00', ref: { noticeNo: 'R26BK01722175', origin: 'g2b' }, status: 'running',
  steps: ['fetch_basic', 'download_attachments', 'extract', 'fetch_html'].map((id) => ({ id: id as never, status: 'pending' as const })),
  attempt: 1, createdAt: 't', updatedAt: 't', errors: [], ...over,
});

/** 파일명 목록으로 API 응답 항목을 만든다. 다운로드 URL은 `https://dl.test/<순번>`. */
export function itemWith(names: string[]): Record<string, string> {
  const item = { ...baseItem };
  for (let i = 1; i <= 10; i++) { item[`ntceSpecFileNm${i}`] = names[i - 1] ?? ''; item[`ntceSpecDocUrl${i}`] = names[i - 1] ? `https://dl.test/${i}` : ''; }
  return item;
}

/** 모든 파일을 같은 문서로 돌려주는 가짜 파서. */
export function fakeParsers(parse: (name: string, signal?: AbortSignal) => Promise<ParseResult>): ParserRegistry {
  return { detect: () => 'txt', get: (format) => ({ id: 'fake', format, parse: (i) => parse(i.name, i.signal) }) };
}
export const docOf = (...lines: string[]): ParseResult => {
  const doc: DocModel = { format: 'txt', blocks: lines.map((text, i) => ({ kind: 'p' as const, text, loc: { block: i } })), warnings: [], stats: { chars: lines.join('').length, tables: 0, ms: 1 } };
  return { ok: true, doc };
};

export interface HarnessOpts {
  files: Record<string, Uint8Array | string>;
  parsers: ParserRegistry;
  store?: MemoryStore;
  html?: HtmlFields;
  job?: Job;
  signal?: AbortSignal;
  settings?: Partial<ReturnType<typeof defaultSettings>['extraction']>;
  rules?: ReturnType<typeof loadRules>;
}

export async function runCollect(o: HarnessOpts): Promise<{ out: CollectOutcome; store: MemoryStore; emitted: JobProgress[]; apiCalls: number; fetchCalls: number }> {
  const store = o.store ?? new MemoryStore();
  const emitted: JobProgress[] = [];
  const names = Object.keys(o.files);
  const counts = { api: 0, all: 0 };
  const fetchFn = async (url: string) => {
    counts.all++;
    if (url.includes('apis.data.go.kr')) {
      counts.api++;
      return new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [itemWith(names)] } } }));
    }
    const name = names[Number(url.split('/').pop()) - 1]!;
    const f = o.files[name]!;
    const bytes = typeof f === 'string' ? new TextEncoder().encode(f) : f;
    return new Response(bytes as unknown as BodyInit, { headers: { 'content-length': String(bytes.length) } });
  };
  const settings = defaultSettings();
  Object.assign(settings.extraction, o.settings);
  const out = await runCollectJob({ job: o.job ?? mkCollectJob(), html: o.html, secrets: { g2bServiceKey: 'K' }, settings }, {
    store, checkPermission: async () => undefined, fetch: fetchFn as unknown as typeof fetch, emit: (p) => emitted.push(p), saveDebounceMs: 5,
    signal: o.signal, extract: { parsers: o.parsers, rules: o.rules ?? loadRules() },
  });
  return { out, store, emitted, apiCalls: counts.api, fetchCalls: counts.all };
}

export const readJsonFile = <T>(store: MemoryStore, suffix: string): T => {
  const k = [...store.files.keys()].find((x) => x.endsWith(suffix));
  if (!k) throw new Error(`없음: ${suffix}`);
  return JSON.parse(store.files.get(k) as string) as T;
};
