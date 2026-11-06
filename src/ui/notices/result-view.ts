import { kindOf } from '../../core/model/ids';
import type { IndexEntry } from '../../core/types/index-file';
import { RESULT_TERMINAL, type FollowTarget } from '../../core/types/result';

/** 낙찰 확정 여부. 1순위(ranked)는 낙찰이 아니다. */
export const isWon = (e: Pick<IndexEntry, 'result'>): boolean => e.result?.status === 'won';

/** 유찰 확정 여부. */
export const isNoBid = (e: Pick<IndexEntry, 'result'>): boolean => e.result?.status === 'no_bid';

export type ResultCell = { tone: 'ok' | 'warn' | 'idle'; text: string } | null;

/** 목록 "개찰/낙찰" 칸. 결과가 확정되면 결과, 아니면 개찰일 기준(개찰 전/개찰 완료). 정보가 없으면 null(대시). 낙찰만 강조. */
export function resultCell(e: Pick<IndexEntry, 'result' | 'schedule' | 'kind'>, now: Date = new Date()): ResultCell {
  if (kindOf(e) === 'prespec') return null;
  const r = e.result;
  if (!r || r.status === 'waiting') {
    const at = e.schedule?.openingAt ? new Date(e.schedule.openingAt) : null;
    if (at && !Number.isNaN(at.getTime())) {
      if (at.getTime() > now.getTime()) return { tone: 'idle', text: `개찰 ${at.getFullYear()}/${p2(at.getMonth() + 1)}/${p2(at.getDate())}(${DOW[at.getDay()]})` };
      return { tone: 'idle', text: r ? '결과 대기' : '개찰 완료' };
    }
    return r ? { tone: 'idle', text: '결과 대기' } : null;
  }
  switch (r.status) {
    case 'won': return { tone: 'ok', text: '낙찰' };
    case 'lost': return { tone: 'idle', text: r.rank ? `탈락(${r.rank}순위)` : '탈락' };
    case 'ranked': return { tone: 'idle', text: r.rank ? `${r.rank}순위` : '순위 확인 중' };
    case 'no_bid': return { tone: 'warn', text: '유찰' };
    case 'not_participated': return { tone: 'idle', text: '미참여' };
    case 'expired': return { tone: 'idle', text: '추적 종료' };
  }
}

export const FOLLOW_TARGET_LABEL: Record<FollowTarget, string> = { rank: '개찰 결과만', final: '낙찰까지' };

export const isFollowing = (e: Pick<IndexEntry, 'following'>): boolean => e.following !== undefined;

export type FollowAction = { follow: false } | { follow: true; target: FollowTarget };
export interface FollowMenuItem { key: FollowTarget | 'off'; label: string; description?: string; warn?: boolean; checked?: boolean; disabled?: boolean; dividerBefore?: boolean }

/** 별/버튼 메뉴 항목. following: 현재 범위(아니면 null). rankDone: result.status === 'ranked'. notify: 전역 알림 설정 */
export function followMenuItems(following: FollowTarget | null, rankDone: boolean, notify: { rank: boolean; final: boolean }): FollowMenuItem[] {
  const rank: FollowMenuItem = rankDone
    ? { key: 'rank', label: FOLLOW_TARGET_LABEL.rank, description: '이미 개찰 순위가 확인된 공고입니다', disabled: true, checked: following === 'rank' }
    : !notify.rank
      ? { key: 'rank', label: FOLLOW_TARGET_LABEL.rank, description: '설정에서 개찰 순위 알림이 꺼져 있어 알림은 오지 않습니다', warn: true, checked: following === 'rank' }
      : { key: 'rank', label: FOLLOW_TARGET_LABEL.rank, description: '순위가 나오면 알리고 팔로우를 끝냅니다', checked: following === 'rank' };
  const final: FollowMenuItem = !notify.final
    ? { key: 'final', label: FOLLOW_TARGET_LABEL.final, description: '설정에서 최종 결과 알림이 꺼져 있어 최종 결과 알림은 오지 않습니다', warn: true, checked: following === 'final' }
    : { key: 'final', label: FOLLOW_TARGET_LABEL.final, description: '순위와 최종 결과를 모두 알립니다', checked: following === 'final' };
  const items = [rank, final];
  if (following !== null) items.push({ key: 'off', label: '팔로우 해제', dividerBefore: true });
  return items;
}

export type FollowButton = { visible: false } | { visible: true; disabled: boolean; reason?: string };

/** 팔로우 버튼 상태. 사전규격은 그리지 않고, 결과가 확정된 공고는 비활성. */
export function followButton(e: Pick<IndexEntry, 'kind' | 'result' | 'following'>): FollowButton {
  if (kindOf(e) === 'prespec') return { visible: false };
  if (!e.following && e.result && RESULT_TERMINAL.has(e.result.status)) return { visible: true, disabled: true, reason: '결과가 확정된 공고입니다' };
  return { visible: true, disabled: false };
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** "10/23(목) 14:00". 오늘이면 "오늘 14:00", 내일이면 "내일 14:00" (로컬 시간). */
export function formatCheckAt(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `오늘 ${hm}`;
  if (diff === 1) return `내일 ${hm}`;
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}(${DOW[d.getDay()]}) ${hm}`;
}

/** 목록 둘째 줄의 팔로우 안내. 팔로우 중이 아니면 null. */
export function followHint(e: Pick<IndexEntry, 'following' | 'result'>, now: Date = new Date()): string | null {
  if (!e.following) return null;
  const start = e.result?.startAt;
  if (start && Date.parse(start) > now.getTime()) return `${formatCheckAt(start, now)}부터 ${e.following === 'rank' ? '순위' : '결과'} 확인`;
  if (e.following === 'rank') return '순위 확인 중';
  if (e.result?.status === 'ranked') return '최종 결과 확인 중';
  return '결과 확인 중';
}

export type TrackStep = { label: string; state: 'done' | 'now' | 'todo' };

/** 상세 화면 결과 추적 줄. 낙찰까지는 3단계, 개찰 결과만은 2단계. */
export function trackSteps(r: IndexEntry['result'] | undefined, now: Date = new Date(), target: FollowTarget = 'final'): TrackStep[] {
  const started = !!r?.startAt && Date.parse(r.startAt) <= now.getTime();
  const opening: TrackStep = started
    ? { label: '개찰', state: 'done' }
    : { label: r?.startAt ? `개찰 ${formatCheckAt(r.startAt, now)}` : '개찰 대기', state: 'now' };
  if (r?.status === 'ranked') {
    const rank = r.rank !== undefined ? `우리 ${r.rank}위${r.bidders ? ` / ${r.bidders}개사` : ''}` : '순위 확인';
    const steps: TrackStep[] = [{ label: '개찰', state: 'done' }, { label: rank, state: 'done' }];
    if (target !== 'rank') steps.push({ label: '최종 낙찰 대기', state: 'now' });
    return steps;
  }
  const steps: TrackStep[] = [opening, { label: started ? '순위 발표 대기' : '순위 발표', state: started ? 'now' : 'todo' }];
  if (target !== 'rank') steps.push({ label: '최종 결과', state: 'todo' });
  return steps;
}

/** follow/set 오류 코드를 화면 문구로. */
export function followErrorText(code: string | undefined, message?: string): string {
  switch (code) {
    case 'FOLLOW_NO_SCHEDULE': return '개찰일시나 제안서 평가일시가 없어 팔로우할 수 없습니다';
    case 'FOLLOW_FINISHED': return '이미 결과가 확정된 공고입니다';
    case 'FOLLOW_UNSUPPORTED': return '사전규격은 팔로우할 수 없습니다';
    case 'FOLLOW_RANK_DONE': return '이미 개찰 순위가 확인된 공고라 개찰 결과만 팔로우할 수 없습니다';
    case 'FOLLOW_BAD_TARGET': return '팔로우 범위가 올바르지 않습니다';
    case 'NEEDS_FS_PERMISSION': return '저장 폴더 권한이 필요합니다. 설정에서 폴더를 다시 승인하세요';
    default: return message ? `팔로우하지 못했습니다. ${message}` : '팔로우하지 못했습니다';
  }
}

/** 팔로우 적용 직후 마스코트 토스트. next: 적용 후 범위(해제면 null), prev: 적용 전 범위 */
export function followToastParts(next: FollowTarget | null, prev: FollowTarget | null, startAt: string | null, now: Date = new Date()): { title: string; text: string; mood: 'happy' | 'idle' } {
  if (next === null) return { title: '팔로우를 해제했습니다', text: '이 공고의 결과 알림을 더 보내지 않아요', mood: 'idle' };
  if (prev !== null && prev !== next) {
    return { title: '팔로우 범위를 바꿨습니다', text: next === 'final' ? '최종 결과까지 알려 드릴게요' : '개찰 순위까지만 알리고 팔로우를 끝낼게요', mood: 'happy' };
  }
  const future = !!startAt && Date.parse(startAt) > now.getTime();
  if (next === 'final') {
    return { title: '팔로우했습니다', text: future ? `${formatCheckAt(startAt, now)}부터 확인해 순위와 최종 결과를 알려 드릴게요` : '순위와 최종 결과를 알려 드릴게요', mood: 'happy' };
  }
  return { title: '팔로우했습니다', text: future ? `${formatCheckAt(startAt, now)}부터 확인해 개찰 순위를 알려 드릴게요` : '개찰 순위가 나오면 알려 드릴게요', mood: 'happy' };
}

/** 금액 "1,284,500,000원". */
export const formatWon = (n: number | undefined): string => (n === undefined ? '' : `${n.toLocaleString('ko-KR')}원`);

/** 1억 이상 "8.2억원"(소수 1자리, .0 제거), 1만 이상 "3,450만원"(내림), 그 외 "9,500원" */
export function formatWonShort(n: number): string {
  if (n >= 100_000_000) return `${(Math.round((n / 100_000_000) * 10) / 10).toLocaleString('en-US')}억원`;
  if (n >= 10_000) return `${Math.floor(n / 10_000).toLocaleString('en-US')}만원`;
  return `${n.toLocaleString('en-US')}원`;
}

/** null → '—', 0.254 → '25%'. 1 미만은 반올림해도 99%까지만(전승처럼 보이지 않게) */
export function formatPercent(r: number | null): string {
  if (r === null) return '—';
  return `${r < 1 ? Math.min(99, Math.round(r * 100)) : Math.round(r * 100)}%`;
}
