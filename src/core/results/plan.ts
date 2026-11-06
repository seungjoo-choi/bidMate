import { kindOf } from '../model/ids';
import { RESULT_TERMINAL, type FollowFile, type ResultEntry, type ResultFile } from '../types/result';
import type { ISODate } from '../types/common';
import type { IndexEntry } from '../types/index-file';
import { FOLLOW_BATCH_MAX, RESULT_BACKFILL_MAX, RESULT_BATCH_MAX, RESULT_FIRST_DELAY_MS } from './limits';
import { followStartAt } from './schedule';

export interface PlanInput {
  index: IndexEntry[];
  results: ResultFile;
  follows: FollowFile;
  now: Date;
  mode: 'list' | 'follow';
}
export interface Plan {
  /** 이번에 확인할 noticeId. 팔로우(due, 상한 20)가 먼저, 일반은 list 모드에서만 개찰일 내림차순 상한 15 */
  targets: string[];
  /** 결과/팔로우 파일에서 지울 noticeId(index에 없음) */
  prune: string[];
  /** 결과 항목이 없어 notice.json에서 일정을 읽어야 하는 공고 */
  needOpening: IndexEntry[];
}

/** 같은 noticeNo에서 round가 가장 큰 bid 공고만 남긴다. */
export function latestBids(index: IndexEntry[]): IndexEntry[] {
  const best = new Map<string, IndexEntry>();
  for (const e of index) {
    if (kindOf(e) !== 'bid') continue;
    const cur = best.get(e.noticeNo);
    if (!cur || Number(e.round) > Number(cur.round)) best.set(e.noticeNo, e);
  }
  return [...best.values()];
}

/** 투찰금액이 없는 종료 항목. won, lost 전부 + expired는 rank가 있을 때만. ourAmount 있거나 amountCheckedAt 있으면 제외. openingAt 내림차순, 상한 RESULT_BACKFILL_MAX */
export function backfillTargets(index: IndexEntry[], results: ResultFile): string[] {
  const out: ResultEntry[] = [];
  for (const e of latestBids(index)) {
    const r = results.entries[e.noticeId];
    if (!r || r.ourAmount !== undefined || r.amountCheckedAt) continue;
    if (r.status === 'won' || r.status === 'lost' || (r.status === 'expired' && r.rank !== undefined)) out.push(r);
  }
  return out.sort((x, y) => Date.parse(y.openingAt) - Date.parse(x.openingAt)).slice(0, RESULT_BACKFILL_MAX).map((r) => r.noticeId);
}

/** 개찰일(없으면 마감일)로 새 결과 항목을 만든다. 둘 다 없으면 null. */
export function newEntry(a: {
  noticeId: string; noticeNo: string; round: string;
  openingAt: ISODate | null; bidCloseAt: ISODate | null; proposalEvalAt: ISODate | null;
}): ResultEntry | null {
  const openingAt = a.openingAt ?? a.bidCloseAt ?? a.proposalEvalAt;
  if (!openingAt || !Number.isFinite(Date.parse(openingAt))) return null;
  const startAt = followStartAt(openingAt, a.proposalEvalAt) ?? openingAt;
  return {
    noticeId: a.noticeId, noticeNo: a.noticeNo, round: a.round,
    status: 'waiting', openingAt,
    ...(a.proposalEvalAt ? { proposalEvalAt: a.proposalEvalAt } : {}),
    startAt, attempts: 0,
    nextCheckAt: new Date(Date.parse(openingAt) + RESULT_FIRST_DELAY_MS).toISOString(),
  };
}

/** 저장된 사업자번호가 현재와 다르면 모든 항목을 waiting/attempts 0/nextCheckAt now로 초기화한다. */
export function resetForBiz(file: ResultFile, bizNo: string, now: Date): ResultFile {
  // bizNo가 비어 있으면 아직 실행 이력이 없는 파일(팔로우 설정이 먼저 만든 항목 보존). 저장 시 bizNo를 기록한다.
  if (file.bizNo === bizNo || file.bizNo === '') return file;
  const nowIso = now.toISOString();
  const entries: Record<string, ResultEntry> = {};
  for (const [id, e] of Object.entries(file.entries)) {
    const { rank: _r, bidders: _b, winnerBizNo: _w, winnerName: _n, awardedAt: _a, amount: _m, ourAmount: _oa, amountCheckedAt: _ac, lastError: _l, checkedAt: _c, listOp: _o, phase: _p, reannounce: _re, ...rest } = e;
    entries[id] = { ...rest, status: 'waiting', attempts: 0, nextCheckAt: nowIso };
  }
  return { ...file, bizNo, entries };
}

export function planTargets(a: PlanInput): Plan {
  const { index, results, follows, now, mode } = a;
  const nowMs = now.getTime();
  const ids = new Set(index.map((e) => e.noticeId));
  const prune = [...new Set([...Object.keys(results.entries), ...Object.keys(follows.entries)].filter((id) => !ids.has(id)))];
  const byId = new Map(index.map((e) => [e.noticeId, e]));
  const latest = latestBids(index);
  const needOpening = latest.filter((e) => !results.entries[e.noticeId]);

  const due = (id: string): ResultEntry | null => {
    const r = results.entries[id];
    return r && !RESULT_TERMINAL.has(r.status) && Date.parse(r.nextCheckAt) <= nowMs ? r : null;
  };
  const followed = Object.keys(follows.entries).filter((id) => byId.has(id) && kindOf(byId.get(id)) === 'bid');
  const followTargets = followed.filter((id) => due(id)).sort((x, y) => Date.parse(results.entries[x]!.nextCheckAt) - Date.parse(results.entries[y]!.nextCheckAt)).slice(0, FOLLOW_BATCH_MAX);
  let general: string[] = [];
  if (mode === 'list') {
    const followedSet = new Set(followed);
    general = latest
      .filter((e) => !followedSet.has(e.noticeId) && due(e.noticeId))
      .sort((x, y) => Date.parse(results.entries[y.noticeId]!.openingAt) - Date.parse(results.entries[x.noticeId]!.openingAt))
      .slice(0, RESULT_BATCH_MAX)
      .map((e) => e.noticeId);
  }
  return { targets: [...followTargets, ...general], prune, needOpening };
}
