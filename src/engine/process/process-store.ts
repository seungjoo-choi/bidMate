import { fetchProcess, mapProcess, PROCESS_OPS } from '../../adapters/g2b/process-api';
import { g2bDetailOf } from '../../adapters/g2b/openapi';
import type { G2bFailureInput } from '../../core/diagnostics/g2b-failure';
import { kindOf } from '../../core/model/ids';
import type { ProcessFile, ProcessGetResult } from '../../core/types/process';
import { PROCESS_TTL_MS } from '../../core/types/process';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { NoticeStore } from '../notices/notice-store';

export const processPath = (folder: string): string => `${folder}/process.json`;

/** 파일 없음, 손상(JSON 파싱 실패 포함), 스키마 불일치는 모두 null로 본다(쓰지 않음). */
async function readProcess(store: IFileStore, folder: string): Promise<ProcessFile | null> {
  try {
    const raw = await readJson<ProcessFile | null>(store, processPath(folder));
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

const hasContract = (f: ProcessFile): boolean => {
  const rounds = f.process?.rounds ?? [];
  const last = rounds[rounds.length - 1];
  return !!last && Array.isArray(last.contracts) && last.contracts.length > 0;
};

export async function getProcess(
  store: IFileStore,
  p: { noticeId: string; serviceKey: string; force?: boolean },
  deps: { fetch: typeof fetch; now?: () => Date; isBusy: (id: string) => boolean; onFailure?: (f: G2bFailureInput) => void },
): Promise<ProcessGetResult> {
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) return { file: null, fromCache: false, error: { code: 'NOT_FOUND', message: '공고를 찾을 수 없습니다.' } };
  const queryNo = kindOf(notice.ref) === 'prespec' ? notice.prespec?.relatedBidNo?.value : notice.ref.noticeNo;
  if (!queryNo) return { file: null, fromCache: false };

  const now = deps.now ?? (() => new Date());
  // 조회 번호가 바뀐 캐시(사전규격의 연계 공고 변경 등)는 없는 것으로 본다.
  const stored = await readProcess(store, notice.folder);
  const cached = stored && stored.queryNoticeNo === queryNo ? stored : null;
  const fresh = !!cached && !p.force && (hasContract(cached) || now().getTime() - Date.parse(cached.fetchedAt) < PROCESS_TTL_MS);
  if (cached && fresh) return { file: cached, fromCache: true };

  if (p.serviceKey.trim() === '') {
    return { file: cached, fromCache: !!cached, error: { code: 'G2B_KEY_MISSING', message: '나라장터 서비스키가 설정되지 않았습니다.' } };
  }

  const r = await fetchProcess(queryNo, cached?.op ? [cached.op] : PROCESS_OPS, { serviceKey: p.serviceKey, fetch: deps.fetch, now });
  if (!r.ok) {
    const d = g2bDetailOf(r.error);
    try {
      deps.onFailure?.({
        flow: 'process', stage: 'fetch', code: r.error.code, message: r.error.message, noticeNo: queryNo, noticeId: p.noticeId,
        ...(d.operation ? { endpoint: d.operation } : {}),
        ...(d.httpStatus !== undefined ? { httpStatus: d.httpStatus } : {}),
        ...(d.g2bMsg ? { g2bMsg: d.g2bMsg } : {}),
        trigger: p.force ? 'manual' : 'detail',
      });
    } catch { /* 진단 기록 실패는 무시 */ }
    return { file: cached, fromCache: !!cached, error: { code: r.error.code, message: r.error.message } };
  }

  const file: ProcessFile = { schemaVersion: 1, noticeId: p.noticeId, queryNoticeNo: queryNo, op: r.op, fetchedAt: r.fetchedAt, process: mapProcess(r.items) };
  if (deps.isBusy(p.noticeId)) return { file, fromCache: false };
  try {
    await store.withLock(processPath(notice.folder), async () => {
      if (deps.isBusy(p.noticeId)) return;
      await writeJson(store, processPath(notice.folder), file);
    });
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    return { file, fromCache: false, error: { code: typeof code === 'string' ? code : 'WRITE_FAILED', message: e instanceof Error ? e.message : String(e) } };
  }
  return { file, fromCache: false };
}
