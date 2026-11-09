import type { IndexEntry } from '../types/index-file';
import type { ResultFile, ResultStatus } from '../types/result';
import { REANNOUNCE_TRACK_DAYS } from './limits';
import { latestBids } from './plan';

const NOISE = ['(재공고)', '[재공고]', '재공고', '[긴급]', '(긴급)', '긴급'];

/** 제목 비교용 정규화. 공백 전부 제거, 재공고와 긴급 표기 제거, 소문자. */
export function normalizeTitle(t: string): string {
  let s = t.replace(/\s+/g, '');
  for (const w of NOISE) s = s.split(w).join('');
  return s.toLowerCase();
}

export interface LinkedChange { id: string; prevStatus: ResultStatus }

/**
 * 수집된 재공고(reannounceOf가 있는 최신 bid 항목)를 원 공고 결과 항목에 잇는다(API 호출 없음).
 * 원 공고가 waiting/expired면 no_bid로 바꾸고 inferredNoBid를 표시한다. 다른 상태는 바꾸지 않는다.
 */
export function linkCollected(index: IndexEntry[], results: ResultFile, now: Date): LinkedChange[] {
  const nowIso = now.toISOString();
  const bids = latestBids(index);
  const byNo = new Map(bids.map((e) => [e.noticeNo, e]));
  const changed: LinkedChange[] = [];
  for (const e of bids) {
    if (!e.reannounceOf) continue;
    const orig = byNo.get(e.reannounceOf);
    if (!orig) continue;
    const r = results.entries[orig.noticeId];
    if (!r) continue;
    if (r.reannounce?.status === 'found') continue;
    const prevStatus = r.status;
    const infer = r.status === 'waiting' || r.status === 'expired';
    r.reannounce = {
      status: 'found',
      since: r.reannounce?.since ?? nowIso,
      nextCheckAt: nowIso,
      attempts: r.reannounce?.attempts ?? 0,
      ...(r.reannounce?.orgCode ? { orgCode: r.reannounce.orgCode } : {}),
      ...(r.reannounce?.opKind ? { opKind: r.reannounce.opKind } : {}),
      found: { noticeNo: e.noticeNo, round: e.round, title: e.title, noticeId: e.noticeId, foundAt: nowIso, via: 'collect' },
      ...(infer ? { inferredNoBid: true as const } : {}),
    };
    if (infer) {
      r.status = 'no_bid';
      r.attempts = 0;
      r.checkedAt = nowIso;
      delete r.rank;
      delete r.bidders;
      delete r.lastError;
    }
    changed.push({ id: orig.noticeId, prevStatus });
  }
  return changed;
}

const DAY_MS = 86_400_000;

/**
 * no_bid인데 감시(reannounce)가 없는 항목에 감시를 만든다(옛 데이터 보충).
 * since는 checkedAt, 없으면 openingAt. 감시 기간을 넘겼으면 바로 expired(호출 없음). 바뀐 noticeId 목록을 돌려준다.
 */
export function ensureWatches(results: ResultFile, now: Date): string[] {
  const nowIso = now.toISOString();
  const changed: string[] = [];
  for (const [id, r] of Object.entries(results.entries)) {
    if (r.status !== 'no_bid' || r.reannounce) continue;
    const since = r.checkedAt ?? r.openingAt;
    const expired = now.getTime() - Date.parse(since) > REANNOUNCE_TRACK_DAYS * DAY_MS;
    r.reannounce = { status: expired ? 'expired' : 'watching', since, nextCheckAt: nowIso, attempts: 0 };
    changed.push(id);
  }
  return changed;
}
