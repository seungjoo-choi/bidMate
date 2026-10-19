import type { EvalRaw } from '../../adapters/g2b/eval-api';
import { fetchOfficialResult } from '../../adapters/g2b/open-result-api';
import { mapEvalRaw } from '../../core/evaluation/map';
import type { EvalCollectResult, EvalRef } from '../../messaging/protocol';
import type { IFileStore } from '../file-store/types';
import { EvalStore, entryOf } from './eval-store';

const OFFICIAL_TIMEOUT_MS = 15_000;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface SaveEvalInput { ref: EvalRef; raw: EvalRaw; serviceKey?: string; fetchWarnings?: string[] }
export interface SaveEvalOpts { now?: () => Date; fetch?: typeof fetch }

/** map, 공식 결과 조회(15초, 실패는 경고), 저장. */
export async function saveEval(store: IFileStore, input: SaveEvalInput, opts: SaveEvalOpts = {}): Promise<EvalCollectResult> {
  const now = opts.now ?? (() => new Date());
  const mapped = mapEvalRaw(input.raw, input.ref, now().toISOString());
  if (!mapped.ok) throw err(mapped.code, mapped.message);
  const record = mapped.record;
  record.warnings.unshift(...(input.fetchWarnings ?? []));

  const key = input.serviceKey?.trim();
  if (!key) {
    record.warnings.push('서비스키가 없어 공식 결과를 가져오지 않았습니다.');
  } else {
    const r = await fetchOfficialResult(input.ref.noticeNo, record.round, { serviceKey: key, fetch: opts.fetch ?? ((...a) => fetch(...a)), timeoutMs: OFFICIAL_TIMEOUT_MS, now });
    if (r.ok) record.official = { fetchedAt: r.fetchedAt, rows: r.rows };
    else record.warnings.push(`공식 결과를 가져오지 못했습니다: ${r.error.message}`);
  }

  const saved = await new EvalStore(store).save(record);
  return { noticeId: saved.noticeId, entry: entryOf(saved), warnings: saved.warnings };
}
