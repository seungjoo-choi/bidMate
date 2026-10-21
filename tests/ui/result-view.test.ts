import { describe, expect, it } from 'vitest';
import type { IndexEntry } from '../../src/core/types/index-file';
import { followButton, followErrorText, followHint, followMenuItems, followToastParts, formatCheckAt, formatPercent, formatWonShort, isFollowing, isWon, resultCell, trackSteps } from '../../src/ui/notices/result-view';

// 2026-10-20(화) 12:00 로컬
const NOW = new Date(2026, 9, 20, 12, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
type E = Pick<IndexEntry, 'kind' | 'result' | 'following'>;

describe('isWon', () => {
  it('won만 낙찰, ranked 1위는 아님', () => {
    expect(isWon({ result: { status: 'won' } })).toBe(true);
    expect(isWon({ result: { status: 'ranked', rank: 1 } })).toBe(false);
    expect(isWon({})).toBe(false);
  });
});

describe('followButton', () => {
  it('사전규격은 숨김, 종료 상태는 비활성, 그 외 활성', () => {
    expect(followButton({ kind: 'prespec' } as E)).toEqual({ visible: false });
    expect(followButton({ result: { status: 'lost' } })).toEqual({ visible: true, disabled: true, reason: '결과가 확정된 공고입니다' });
    expect(followButton({ result: { status: 'waiting' } })).toEqual({ visible: true, disabled: false });
    expect(followButton({})).toEqual({ visible: true, disabled: false });
  });
});

describe('formatCheckAt', () => {
  it('오늘, 내일, 그 외 요일 표기', () => {
    expect(formatCheckAt(at(20, 15), NOW)).toBe('오늘 15:00');
    expect(formatCheckAt(at(21, 9, 5), NOW)).toBe('내일 09:05');
    expect(formatCheckAt(at(23, 14), NOW)).toBe('2026/10/23(금) 14:00');
    expect(formatCheckAt(null, NOW)).toBe('');
  });
});

describe('followHint', () => {
  it('팔로우 아니면 null, 시작 전이면 시작 시각, 이후는 단계별 문구', () => {
    expect(followHint({ result: { status: 'waiting' } }, NOW)).toBeNull();
    expect(followHint({ following: 'final', result: { status: 'waiting', startAt: at(23, 14) } }, NOW)).toBe('2026/10/23(금) 14:00부터 결과 확인');
    expect(followHint({ following: 'final', result: { status: 'waiting', startAt: at(19, 14) } }, NOW)).toBe('결과 확인 중');
    expect(followHint({ following: 'final', result: { status: 'ranked', startAt: at(19, 14) } }, NOW)).toBe('최종 결과 확인 중');
    expect(followHint({ following: 'rank', result: { status: 'waiting', startAt: at(23, 14) } }, NOW)).toBe('2026/10/23(금) 14:00부터 순위 확인');
    expect(followHint({ following: 'rank', result: { status: 'waiting', startAt: at(19, 14) } }, NOW)).toBe('순위 확인 중');
  });
});

describe('isFollowing', () => {
  it('범위가 있으면 true, 없으면 false', () => {
    expect(isFollowing({ following: 'rank' })).toBe(true);
    expect(isFollowing({})).toBe(false);
  });
});

describe('followMenuItems', () => {
  const on = { rank: true, final: true };
  it('팔로우 아님: 두 항목, 체크 없음, 기본 문구', () => {
    const items = followMenuItems(null, false, on);
    expect(items.map((i) => i.key)).toEqual(['rank', 'final']);
    expect(items.every((i) => !i.checked)).toBe(true);
    expect(items[0]!.description).toBe('순위가 나오면 알리고 팔로우를 끝냅니다');
    expect(items[1]!.description).toBe('순위와 최종 결과를 모두 알립니다');
  });
  it('팔로우 중: 현재 범위 체크, 해제 항목은 구분선', () => {
    const items = followMenuItems('final', false, on);
    expect(items.find((i) => i.key === 'final')!.checked).toBe(true);
    expect(items.find((i) => i.key === 'off')).toMatchObject({ label: '팔로우 해제', dividerBefore: true });
  });
  it('순위 확인된 공고는 개찰 결과만 비활성', () => {
    expect(followMenuItems('final', true, on)[0]).toMatchObject({ disabled: true, description: '이미 개찰 순위가 확인된 공고입니다' });
  });
  it('전역 알림이 꺼져 있으면 설명만 경고', () => {
    const a = followMenuItems(null, false, { rank: false, final: true });
    expect(a[0]).toMatchObject({ warn: true, description: '설정에서 개찰 순위 알림이 꺼져 있어 알림은 오지 않습니다' });
    expect(a[0]!.disabled).toBeFalsy();
    const b = followMenuItems(null, false, { rank: true, final: false });
    expect(b[1]).toMatchObject({ warn: true, description: '설정에서 최종 결과 알림이 꺼져 있어 최종 결과 알림은 오지 않습니다' });
  });
});

describe('trackSteps', () => {
  it('개찰 전', () => {
    expect(trackSteps({ status: 'waiting', startAt: at(23, 14) }, NOW)).toEqual([
      { label: '개찰 2026/10/23(금) 14:00', state: 'now' }, { label: '순위 발표', state: 'todo' }, { label: '최종 결과', state: 'todo' },
    ]);
  });
  it('개찰 후 순위 대기', () => {
    expect(trackSteps({ status: 'waiting', startAt: at(19, 14) }, NOW).map((s) => s.state)).toEqual(['done', 'now', 'todo']);
  });
  it('개찰 결과만은 2단계, 낙찰까지는 3단계', () => {
    expect(trackSteps({ status: 'waiting', startAt: at(23, 14) }, NOW, 'rank')).toHaveLength(2);
    expect(trackSteps({ status: 'waiting', startAt: at(23, 14) }, NOW, 'final')).toHaveLength(3);
  });
  it('순위 확인 후 최종 대기', () => {
    expect(trackSteps({ status: 'ranked', rank: 1, bidders: 5, startAt: at(19, 14) }, NOW)).toEqual([
      { label: '개찰', state: 'done' }, { label: '우리 1위 / 5개사', state: 'done' }, { label: '최종 낙찰 대기', state: 'now' },
    ]);
  });
});

describe('follow 문구', () => {
  it('오류 코드별 문구', () => {
    expect(followErrorText('FOLLOW_NO_SCHEDULE')).toContain('개찰일시');
    expect(followErrorText('FOLLOW_FINISHED')).toBe('이미 결과가 확정된 공고입니다');
    expect(followErrorText(undefined, 'x')).toBe('팔로우하지 못했습니다. x');
    expect(followErrorText('FOLLOW_RANK_DONE')).toBe('이미 개찰 순위가 확인된 공고라 개찰 결과만 팔로우할 수 없습니다');
  });
});

describe('resultCell', () => {
  it('상태별 문구와 톤', () => {
    expect(resultCell({})).toBeNull();
    expect(resultCell({ result: { status: 'won' } })).toEqual({ tone: 'ok', text: '낙찰' });
    expect(resultCell({ result: { status: 'lost', rank: 2 } })).toEqual({ tone: 'idle', text: '탈락(2순위)' });
    expect(resultCell({ result: { status: 'lost' } })?.text).toBe('탈락');
    expect(resultCell({ result: { status: 'ranked', rank: 1 } })?.text).toBe('1순위');
    expect(resultCell({ result: { status: 'no_bid' } })?.text).toBe('유찰');
    expect(resultCell({ result: { status: 'not_participated' } })?.text).toBe('미참여');
    expect(resultCell({ result: { status: 'expired' } })?.text).toBe('추적 종료');
    expect(resultCell({ result: { status: 'waiting' } })?.text).toBe('결과 대기');
  });
  it('결과가 없으면 개찰일 기준', () => {
    const now = new Date('2026-10-21T12:00:00+09:00');
    expect(resultCell({ schedule: { openingAt: '2026-10-23T11:00:00+09:00' } }, now)?.text).toBe('개찰 2026/10/23(금)');
    expect(resultCell({ schedule: { openingAt: '2026-10-20T11:00:00+09:00' } }, now)?.text).toBe('개찰 완료');
    expect(resultCell({ result: { status: 'waiting' }, schedule: { openingAt: '2026-10-20T11:00:00+09:00' } }, now)?.text).toBe('결과 대기');
    expect(resultCell({ result: { status: 'won' }, schedule: { openingAt: '2026-10-30T11:00:00+09:00' } }, now)?.text).toBe('낙찰');
    expect(resultCell({ kind: 'prespec', schedule: { openingAt: '2026-10-23T11:00:00+09:00' } }, now)).toBeNull();
  });
});

describe('followToastParts', () => {
  const now = new Date('2026-10-21T12:00:00+09:00');
  it('해제, 새 팔로우, 범위 변경', () => {
    expect(followToastParts(null, 'final', null, now)).toEqual({ title: '팔로우를 해제했습니다', text: '이 공고의 결과 알림을 더 보내지 않아요', mood: 'idle' });
    expect(followToastParts('final', null, '2026-10-23T11:00:00+09:00', now).text).toMatch(/부터 확인해 순위와 최종 결과를 알려 드릴게요$/);
    expect(followToastParts('rank', null, null, now).text).toBe('개찰 순위가 나오면 알려 드릴게요');
    expect(followToastParts('rank', 'final', null, now)).toMatchObject({ title: '팔로우 범위를 바꿨습니다', text: '개찰 순위까지만 알리고 팔로우를 끝낼게요' });
    expect(followToastParts('final', 'rank', null, now).text).toBe('최종 결과까지 알려 드릴게요');
  });
});

describe('formatWonShort/formatPercent', () => {
  it('경계', () => {
    expect(formatWonShort(9_999)).toBe('9,999원');
    expect(formatWonShort(9_500)).toBe('9,500원');
    expect(formatWonShort(10_000)).toBe('1만원');
    expect(formatWonShort(34_509_999)).toBe('3,450만원');
    expect(formatWonShort(100_000_000)).toBe('1억원');
    expect(formatWonShort(820_000_000)).toBe('8.2억원');
    expect(formatWonShort(1_200_000_000)).toBe('12억원');
  });
  it('퍼센트', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.254)).toBe('25%');
  });
});
