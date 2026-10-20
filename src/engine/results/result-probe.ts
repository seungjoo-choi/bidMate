import { AWARD_OPS, fetchAwardRaw, fetchOpeningRaw, type RawResult } from '../../adapters/g2b/award-api';
import { redactKey } from '../../adapters/g2b/openapi';
import type { ProbePart, ResultProbeResult } from '../../core/types/result';

function toPart(r: RawResult, serviceKey: string): ProbePart {
  if (!r.ok) return { ok: false, count: 0, keys: [], sample: [], error: redactKey(`${r.error.code}: ${r.error.message}`, serviceKey) };
  const keys = [...new Set(r.items.flatMap((i) => Object.keys(i)))].sort();
  return { ok: true, count: r.items.length, keys, sample: r.items.slice(0, 3) };
}

/** 1단계 1회와 2단계 전 op를 모두 호출해 응답 형태를 돌려준다(순회 중단 없음, 저장 없음). */
export async function probeResult(noticeNo: string, serviceKey: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<ResultProbeResult> {
  const ctx = { serviceKey, fetch: fetchFn };
  const opening = toPart(await fetchOpeningRaw(noticeNo, ctx), serviceKey);
  const award: ResultProbeResult['award'] = [];
  for (const op of AWARD_OPS) award.push({ op, ...toPart(await fetchAwardRaw(noticeNo, op, ctx), serviceKey) });
  return { opening, award };
}
