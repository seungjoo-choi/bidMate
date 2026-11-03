import type { EvalRaw } from '../../adapters/g2b/eval-api';
import { fetchOfficialResult } from '../../adapters/g2b/open-result-api';
import { g2bDetailOf } from '../../adapters/g2b/openapi';
import type { G2bFailureInput } from '../../core/diagnostics/g2b-failure';
import { mapEvalRaw } from '../../core/evaluation/map';
import type { EvalCollectResult, EvalRef } from '../../messaging/protocol';
import type { IFileStore } from '../file-store/types';
import { EvalStore, entryOf } from './eval-store';

const OFFICIAL_TIMEOUT_MS = 15_000;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface SaveEvalInput { ref: EvalRef; raw: EvalRaw; serviceKey?: string; fetchWarnings?: string[] }
export interface SaveEvalOpts { now?: () => Date; fetch?: typeof fetch; onFailure?: (f: G2bFailureInput) => void }

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
    else {
      record.warnings.push(`공식 결과를 가져오지 못했습니다: ${r.error.message}`);
      const d = g2bDetailOf(r.error);
      try {
        opts.onFailure?.({
          flow: 'eval', stage: 'official', code: r.error.code, message: r.error.message, noticeNo: input.ref.noticeNo, round: record.round,
          trigger: 'eval-save',
          ...(d.operation ? { endpoint: d.operation } : {}),
          ...(d.httpStatus !== undefined ? { httpStatus: d.httpStatus } : {}),
          ...(d.g2bMsg ? { g2bMsg: d.g2bMsg } : {}),
        });
      } catch { /* 진단 보고 실패는 저장을 깨지 않는다 */ }
    }
  }

  const saved = await new EvalStore(store).save(record);
  return { noticeId: saved.noticeId, entry: entryOf(saved), warnings: saved.warnings };
}
