import { AWARD_OPS, fetchAward, fetchOpening } from '../../adapters/g2b/award-api';
import { g2bDetailOf, redactKey, type G2bContext } from '../../adapters/g2b/openapi';
import type { G2bFailureInput } from '../../core/diagnostics/g2b-failure';
import type { JobError } from '../../core/types/job';
import { normalizeBizNo } from '../../core/evaluation/company';
import { applyOurAmount, judge, shouldFetchAward } from '../../core/results/judge';
import { backfillTargets, latestBids, newEntry, planTargets, resetForBiz } from '../../core/results/plan';
import { followNextCheckAt, followStartAt } from '../../core/results/schedule';
import type { IndexEntry } from '../../core/types/index-file';
import { RESULT_TERMINAL, type FollowFile, type NotifyEvent, type ResultEntry, type ResultFile, type ResultRunSummary } from '../../core/types/result';
import { NoticeStore } from '../notices/notice-store';
import type { IFileStore } from '../file-store/types';
import { FollowStore } from './follow-store';
import { isPermission, readSchedule, ResultStore, RESULTS_LOCK } from './result-store';

export interface ResultTrackerDeps {
  store: IFileStore;
  fetch: typeof fetch;
  serviceKey: string;
  /** 우리 사업자번호(하이픈 허용, 숫자 10자리여야 함) */
  bizNo: string;
  now?: () => Date;
  /** 저장 폴더 권한이 살아 있는지. false면 NO_FS로 건너뛴다. */
  checkPermission: () => Promise<boolean>;
  /** 조회 최종 실패 보고(진단용). throw해도 run은 계속된다. */
  onFailure?: (f: G2bFailureInput) => void;
}

const isKeyError = (code: string): boolean => code === 'G2B_KEY_INVALID' || code === 'G2B_KEY_MISSING';
const iso = (ms: number): string => new Date(ms).toISOString();
const changed = (a: ResultEntry, b: ResultEntry): boolean =>
  a.status !== b.status || a.rank !== b.rank || a.bidders !== b.bidders || a.winnerBizNo !== b.winnerBizNo || a.amount !== b.amount || a.ourAmount !== b.ourAmount;

function minNext(results: ResultFile, follows: FollowFile): string | null {
  let min: number | null = null;
  for (const id of Object.keys(follows.entries)) {
    const r = results.entries[id];
    if (!r || RESULT_TERMINAL.has(r.status)) continue;
    const t = Date.parse(r.nextCheckAt);
    if (min === null || t < min) min = t;
  }
  return min === null ? null : iso(min);
}

export async function runResultRefresh(deps: ResultTrackerDeps, opts: { mode: 'list' | 'follow' }): Promise<ResultRunSummary> {
  const now = deps.now ?? (() => new Date());
  const base: ResultRunSummary = { ran: false, checked: 0, updated: 0, won: 0, nextFollowCheckAt: null, events: [] };
  if (!deps.serviceKey?.trim()) return { ...base, skipped: 'NO_KEY' };
  const ours = normalizeBizNo(deps.bizNo);
  if (ours.length !== 10) return { ...base, skipped: 'NO_BIZNO' };
  try {
    if (!(await deps.checkPermission())) return { ...base, skipped: 'NO_FS' };
    return await run(deps, opts.mode, ours, now, base);
  } catch (e) {
    if (isPermission(e)) return { ...base, skipped: 'NO_FS' };
    return { ...base, error: redactKey(e instanceof Error ? e.message : String(e), deps.serviceKey) };
  }
}

async function run(deps: ResultTrackerDeps, mode: 'list' | 'follow', ours: string, now: () => Date, base: ResultRunSummary): Promise<ResultRunSummary> {
  const { store } = deps;
  const t0 = now();
  const rs = new ResultStore(store);
  const fs = new FollowStore(store, now);
  const index = (await new NoticeStore(store).loadIndex()).notices;
  const byId = new Map<string, IndexEntry>(index.map((e) => [e.noticeId, e]));

  const loaded = await rs.load();
  const results = resetForBiz(loaded, ours, t0);
  const resetAll = results !== loaded;
  const follows = await fs.load();
  const touched = new Set<string>();
  const pruned = new Set<string>();
  const followTouched = new Set<string>();
  /** 이번 실행에서 round 이전으로 새로 만든 팔로우 id -> 원래 id */
  const followMoved = new Map<string, string>();
  const followRemoved = new Set<string>();
  /** 이번 실행에서 순위 이벤트가 난 팔로우. 저장 시점의 범위가 '개찰 결과만'이면 해제한다(실행 중 범위 변경 반영) */
  const rankSeen = new Set<string>();
  const out: ResultRunSummary = { ...base, ran: true };

  const doPrune = (ids: string[]) => {
    for (const id of ids) {
      if (results.entries[id]) { delete results.entries[id]; pruned.add(id); }
      if (follows.entries[id]) { delete follows.entries[id]; followRemoved.add(id); }
    }
  };
  doPrune(planTargets({ index, results, follows, now: t0, mode }).prune);

  try {
    if (mode === 'list') {
      // 더 큰 round가 수집됐으면 팔로우를 그 공고로 옮긴다(notified 승계).
      const latestByNo = new Map(latestBids(index).map((e) => [e.noticeNo, e]));
      for (const id of Object.keys(follows.entries)) {
        const e = byId.get(id);
        const l = e ? latestByNo.get(e.noticeNo) : undefined;
        if (!e || !l || l.noticeId === id) continue;
        if (!follows.entries[l.noticeId]) {
          follows.entries[l.noticeId] = { ...follows.entries[id]!, noticeId: l.noticeId };
          followTouched.add(l.noticeId);
          followMoved.set(l.noticeId, id);
        }
        delete follows.entries[id];
        followRemoved.add(id);
      }
      // 팔로우 공고의 일정이 바뀌었으면 startAt과 다음 확인 시각을 다시 잡는다.
      for (const id of Object.keys(follows.entries)) {
        const r = results.entries[id];
        const e = byId.get(id);
        if (!r || !e || RESULT_TERMINAL.has(r.status)) continue;
        const sch = await readSchedule(store, e);
        const opening = sch ? sch.openingAt ?? sch.bidCloseAt : null;
        if (!sch || !opening) continue;
        const startAt = followStartAt(opening, sch.proposalEvalAt) ?? opening;
        if (opening === r.openingAt && (sch.proposalEvalAt ?? undefined) === r.proposalEvalAt && startAt === r.startAt) continue;
        const next: ResultEntry = { ...r, openingAt: opening, startAt, attempts: 0 };
        if (sch.proposalEvalAt) next.proposalEvalAt = sch.proposalEvalAt; else delete next.proposalEvalAt;
        const nx = followNextCheckAt(next, t0.getTime());
        if (nx !== null) next.nextCheckAt = iso(nx);
        results.entries[id] = next;
        touched.add(id);
      }
    }

    // 결과 항목이 없는 공고는 notice.json을 1회 읽어 만든다.
    for (const e of planTargets({ index, results, follows, now: t0, mode }).needOpening) {
      const sch = await readSchedule(store, e);
      if (!sch) continue;
      const entry = newEntry({ noticeId: e.noticeId, noticeNo: e.noticeNo, round: e.round, openingAt: sch.openingAt, bidCloseAt: sch.bidCloseAt ?? e.bidCloseAt ?? null, proposalEvalAt: sch.proposalEvalAt });
      if (!entry) continue;
      if (follows.entries[e.noticeId]) {
        const nx = followNextCheckAt(entry, t0.getTime());
        if (nx !== null) entry.nextCheckAt = iso(nx);
      }
      results.entries[e.noticeId] = entry;
      touched.add(e.noticeId);
    }

    const ctx: G2bContext = { serviceKey: deps.serviceKey, fetch: deps.fetch, now };
    const fail = (stage: 'opening' | 'award', e: IndexEntry, err: JobError): void => {
      const d = g2bDetailOf(err);
      try {
        deps.onFailure?.({
          flow: 'result', stage, code: err.code, message: err.message, noticeNo: e.noticeNo, round: e.round, noticeId: e.noticeId,
          ...(d.operation ? { endpoint: d.operation } : {}),
          ...(d.httpStatus !== undefined ? { httpStatus: d.httpStatus } : {}),
          ...(d.g2bMsg ? { g2bMsg: d.g2bMsg } : {}),
          trigger: mode,
        });
      } catch { /* 진단 보고 실패는 run을 깨지 않는다 */ }
    };
    for (const id of planTargets({ index, results, follows, now: t0, mode }).targets) {
      const e = byId.get(id);
      const prev = results.entries[id];
      if (!e || !prev) continue;
      const nt = now();
      const opening = await fetchOpening(e.noticeNo, ctx);
      if (!opening.ok) fail('opening', e, opening.error);
      if (!opening.ok && isKeyError(opening.error.code)) { out.skipped = 'KEY_INVALID'; out.ran = false; break; }
      let j = judge({ ourBizNo: ours, now: nt, prev, opening, award: null });
      if (shouldFetchAward(prev, opening, j.entry, ours)) {
        const award = await fetchAward(e.noticeNo, prev.listOp ? [prev.listOp] : AWARD_OPS, ctx);
        if (!award.ok) fail('award', e, award.error);
        if (!award.ok && isKeyError(award.error.code)) { out.skipped = 'KEY_INVALID'; out.ran = false; break; }
        j = judge({ ourBizNo: ours, now: nt, prev, opening, award });
      }
      let entry = j.entry;
      // 종료 판정에 쓴 1단계 응답에서 이미 투찰금액을 읽었으므로 백필 대상에서 뺀다(값 유무와 무관).
      if (opening.ok && RESULT_TERMINAL.has(entry.status)) entry = { ...entry, amountCheckedAt: nt.toISOString() };
      const f = follows.entries[id];
      const endsByRank = !!f && f.target === 'rank' && j.event === 'rank';
      if (f && !endsByRank) {
        const nx = followNextCheckAt(entry, nt.getTime());
        if (nx !== null) entry = { ...entry, nextCheckAt: iso(nx) };
      }
      results.entries[id] = entry;
      touched.add(id);
      out.checked++;
      if (changed(prev, entry)) out.updated++;
      if (entry.status === 'won' && prev.status !== 'won') out.won++;
      if (!f || !j.event) continue;
      let ev: NotifyEvent | null = null;
      if (j.event === 'rank') {
        if (!f.notified.rank && entry.rank !== undefined) {
          ev = { kind: 'rank', noticeId: id, title: e.title, rank: entry.rank, bidders: entry.bidders ?? 0, ...(endsByRank ? { followEnded: true as const } : {}) };
          f.notified.rank = nt.toISOString();
          followTouched.add(id);
        }
        rankSeen.add(id); // 해제 여부는 저장 시점의 범위로 정한다(아래 finally)
      } else {
        if (!f.notified.final) {
          ev = j.event === 'expired'
            ? { kind: 'expired', noticeId: id, title: e.title }
            : { kind: 'final', noticeId: id, title: e.title, status: entry.status as 'won' | 'lost' | 'not_participated' | 'no_bid', ...(entry.rank !== undefined ? { rank: entry.rank } : {}), ...(entry.winnerName ? { winnerName: entry.winnerName } : {}) };
        }
        delete follows.entries[id]; // 결과 확정/종료는 자동 해제
        followRemoved.add(id);
      }
      if (ev) out.events.push(ev);
    }

    // 투찰금액 백필: 1단계만 조회하고 상태는 바꾸지 않는다. 키 오류로 중단됐으면 건너뛴다.
    // 이번 실행에서 이미 1단계를 읽은 항목은 같은 응답을 다시 받게 되므로 다음 실행으로 미룬다.
    if (mode === 'list' && out.skipped !== 'KEY_INVALID') {
      const seen = new Set(touched);
      for (const id of backfillTargets(index, results)) {
        if (seen.has(id)) continue;
        const e = byId.get(id);
        const prev = results.entries[id];
        if (!e || !prev) continue;
        const opening = await fetchOpening(e.noticeNo, ctx);
        if (!opening.ok) {
          fail('opening', e, opening.error);
          if (isKeyError(opening.error.code)) { out.skipped = 'KEY_INVALID'; out.ran = false; break; }
          continue;
        }
        const entry = applyOurAmount(prev, opening.rows, ours, now().toISOString());
        results.entries[id] = entry;
        touched.add(id);
        if (changed(prev, entry)) out.updated++;
      }
    }
  } finally {
    const nowIso = now().toISOString();
    const dirty = resetAll || touched.size > 0 || pruned.size > 0 || followTouched.size > 0 || followRemoved.size > 0;
    if (dirty) {
      // results.json 다음 follows.json 순서. 실행 중 다른 쓰기(팔로우 설정)가 있었으면 다시 읽어 우리가 바꾼 항목만 덮는다.
      await store.withLock(RESULTS_LOCK, async () => {
        let file = results;
        if (!resetAll) {
          const fresh = await rs.load();
          if (fresh.bizNo === ours || fresh.bizNo === '') {
            for (const id of touched) if (results.entries[id]) fresh.entries[id] = results.entries[id]!;
            for (const id of pruned) delete fresh.entries[id];
            file = fresh;
          }
        }
        file.bizNo = ours;
        file.updatedAt = nowIso;
        // 실행 중 다른 쓰기가 있었을 수 있어 follows를 먼저 다시 읽는다. 실행 중 해제된 팔로우는 되살리지 않는다.
        const ff = await fs.load();
        const movedOk = new Set([...followMoved].filter(([, old]) => ff.entries[old]).map(([id]) => id));
        for (const id of followRemoved) delete ff.entries[id];
        for (const id of followTouched) {
          const mine = follows.entries[id];
          if (!mine) continue;
          const cur = ff.entries[id];
          // 실행 중 사용자가 범위를 바꿨을 수 있으므로 통째로 덮지 않고 알림 기록만 합친다.
          if (cur) ff.entries[id] = { ...cur, notified: { ...cur.notified, ...mine.notified } };
          else if (movedOk.has(id)) ff.entries[id] = mine;
        }
        for (const id of rankSeen) if (ff.entries[id]?.target === 'rank') delete ff.entries[id]; // 개찰 결과만 팔로우는 순위 확인으로 해제
        ff.updatedAt = nowIso;
        // 팔로우 공고의 다음 확인 시각을 팔로우 주기로 당긴다(min이라 아직 due 아닌 시각은 뒤로 밀지 않는다).
        const nowMs = now().getTime();
        for (const id of Object.keys(ff.entries)) {
          const e = file.entries[id];
          if (!e || RESULT_TERMINAL.has(e.status)) continue;
          const nx = followNextCheckAt(e, nowMs);
          if (nx !== null && nx < Date.parse(e.nextCheckAt)) file.entries[id] = { ...e, nextCheckAt: iso(nx) };
        }
        await rs.save(file);
        await fs.save(ff);
        out.nextFollowCheckAt = minNext(file, ff);
      });
    } else {
      out.nextFollowCheckAt = minNext(results, follows);
    }
  }
  return out;
}
