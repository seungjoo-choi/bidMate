import { backoffMs } from '../../core/results/judge';
import { newEntry } from '../../core/results/plan';
import { followNextCheckAt, followStartAt } from '../../core/results/schedule';
import { kindOf } from '../../core/model/ids';
import type { ISODate } from '../../core/types/common';
import { RESULT_TERMINAL, type FollowFile, type FollowTarget, type ResultEntry, type ResultFile } from '../../core/types/result';
import type { IFileStore } from '../file-store/types';
import { NoticeStore } from '../notices/notice-store';
import { FollowStore } from './follow-store';
import { readSchedule, ResultStore, RESULTS_LOCK } from './result-store';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface SetFollowResult { following: boolean; target: FollowTarget | null; nextFollowCheckAt: ISODate | null; startAt: ISODate | null }

function minNext(results: ResultFile, follows: FollowFile): ISODate | null {
  let min: number | null = null;
  for (const id of Object.keys(follows.entries)) {
    const r = results.entries[id];
    if (!r || RESULT_TERMINAL.has(r.status)) continue;
    const t = Date.parse(r.nextCheckAt);
    if (min === null || t < min) min = t;
  }
  return min === null ? null : new Date(min).toISOString();
}

/** 팔로우 켜기/끄기. 끄면 follows에서만 제거하고 결과 항목은 남긴다. */
export async function setFollow(
  store: IFileStore,
  p: { noticeId: string; follow: boolean; target?: FollowTarget },
  opts: { now?: () => Date } = {},
): Promise<SetFollowResult> {
  const now = opts.now ?? (() => new Date());
  const entry = (await new NoticeStore(store).loadIndex()).notices.find((e) => e.noticeId === p.noticeId);
  if (!entry) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  const rs = new ResultStore(store);
  const fs = new FollowStore(store, now);

  if (p.follow) {
    const target: FollowTarget = p.target ?? 'final';
    if (kindOf(entry) !== 'bid') throw err('FOLLOW_UNSUPPORTED', '사전규격은 팔로우할 수 없습니다.');
    const sch = await readSchedule(store, entry);
    const startAt = followStartAt(sch?.openingAt ?? null, sch?.proposalEvalAt ?? null);
    if (!sch || !startAt) throw err('FOLLOW_NO_SCHEDULE', '개찰일시나 제안서 평가일시가 없어 팔로우할 수 없습니다.');
    return store.withLock(RESULTS_LOCK, async () => {
      const t = now();
      const results = await rs.load();
      const follows = await fs.load();
      let r: ResultEntry | null = results.entries[p.noticeId] ?? null;
      if (r && RESULT_TERMINAL.has(r.status)) throw err('FOLLOW_FINISHED', '이미 결과가 확정된 공고입니다.');
      if (target === 'rank' && r && r.status === 'ranked') throw err('FOLLOW_RANK_DONE', '이미 개찰 순위가 확인된 공고라 개찰 결과만 팔로우할 수 없습니다.');
      if (!r) {
        r = newEntry({ noticeId: entry.noticeId, noticeNo: entry.noticeNo, round: entry.round, openingAt: sch.openingAt, bidCloseAt: sch.bidCloseAt, proposalEvalAt: sch.proposalEvalAt });
        if (!r) throw err('FOLLOW_NO_SCHEDULE', '개찰일시나 제안서 평가일시가 없어 팔로우할 수 없습니다.');
      }
      const next: ResultEntry = { ...r, startAt };
      if (sch.proposalEvalAt) next.proposalEvalAt = sch.proposalEvalAt;
      const nx = followNextCheckAt(next, t.getTime());
      if (nx !== null) next.nextCheckAt = new Date(nx).toISOString();
      results.entries[p.noticeId] = next;
      results.updatedAt = t.toISOString();
      const cur = follows.entries[p.noticeId];
      if (cur) {
        // 개찰 결과만으로 바꾸면 순위 알림 기록을 비운다. 다음 순위 확인 때 알림 없이 조용히 해제되는 것을 막는다.
        if (target === 'rank' && cur.target !== 'rank') delete cur.notified.rank;
        cur.target = target;
      }
      else follows.entries[p.noticeId] = { noticeId: p.noticeId, followedAt: t.toISOString(), target, notified: {} };
      follows.updatedAt = t.toISOString();
      await rs.save(results);
      await fs.save(follows);
      return { following: true, target, nextFollowCheckAt: minNext(results, follows), startAt };
    });
  }

  return store.withLock(RESULTS_LOCK, async () => {
    const t = now();
    const results = await rs.load();
    const follows = await fs.load();
    const r = results.entries[p.noticeId];
    if (follows.entries[p.noticeId]) {
      delete follows.entries[p.noticeId];
      follows.updatedAt = t.toISOString();
      if (r && !RESULT_TERMINAL.has(r.status)) {
        // 일반 확인 주기(backoff)로 되돌린다.
        results.entries[p.noticeId] = { ...r, nextCheckAt: new Date(t.getTime() + backoffMs(Math.max(r.attempts, 1))).toISOString() };
        results.updatedAt = t.toISOString();
        await rs.save(results);
      }
      await fs.save(follows);
    }
    return { following: false, target: null, nextFollowCheckAt: minNext(results, follows), startAt: r?.startAt ?? null };
  });
}
