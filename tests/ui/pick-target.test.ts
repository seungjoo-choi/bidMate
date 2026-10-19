import { describe, expect, it } from 'vitest';
import type { Job } from '../../src/core/types/job';
import { pickTarget, type Focus } from '../../src/entrypoints/sidepanel/pick-target';

const t = (m: number) => new Date(2026, 9, 19, 14, m).toISOString();
const job = (id: string, p: Partial<Job>): Job => ({
  id, type: 'collect', status: 'completed', steps: [], attempt: 1, createdAt: t(0), updatedAt: t(0), errors: [], ...p,
});
const none = { found: false };
const focus = (noticeId: string, tabId: number, at: string): Focus => ({ noticeId, tabId, at });

describe('pickTarget', () => {
  it('1 감지된 공고: 자기 잡이 있으면 그 잡, 없으면 lookup noticeId', () => {
    const mine = job('a', { noticeId: 'N-A', ref: { noticeNo: 'A', origin: 'g2b' } });
    const other = job('b', { noticeId: 'N-B', ref: { noticeNo: 'B', origin: 'g2b' }, status: 'running', originTabId: 1 });
    const det = { noticeNo: 'A' };
    expect(pickTarget([other, mine], det, none, focus('N-B', 1, t(1)), 1)).toEqual({ job: mine, noticeId: 'N-A' });
    expect(pickTarget([other], det, { found: true, noticeId: 'N-L' }, null, 1)).toEqual({ job: null, noticeId: 'N-L' });
  });
  it('2 활성 탭에서 시작한 진행 중 잡(focus 없음)', () => {
    const run = job('r', { noticeId: 'N-R', status: 'running', originTabId: 5 });
    const old = job('o', { noticeId: 'N-O' });
    expect(pickTarget([old, run], null, none, null, 5)).toEqual({ job: run, noticeId: 'N-R' });
  });
  it('focus 뒤 같은 탭에서 새 수집을 시작하면 그 수집이 우선', () => {
    const run = job('r', { noticeId: 'N-R', status: 'running', originTabId: 5, createdAt: t(10) });
    const done = job('d', { noticeId: 'N-F' });
    expect(pickTarget([run, done], null, none, focus('N-F', 5, t(5)), 5).job).toBe(run);
  });
  it('3 다른 탭 수집 중이어도 이 탭 focus가 우선', () => {
    const run = job('r', { noticeId: 'N-R', status: 'running', originTabId: 9 });
    const done = job('d', { noticeId: 'N-F' });
    expect(pickTarget([run, done], null, none, focus('N-F', 5, t(5)), 5)).toEqual({ job: done, noticeId: 'N-F' });
    // focus 이전에 시작된 같은 탭 진행 중 잡도 focus가 우선
    const early = job('e', { noticeId: 'N-E', status: 'running', originTabId: 5, createdAt: t(1) });
    expect(pickTarget([early, done], null, none, focus('N-F', 5, t(5)), 5).job).toBe(done);
  });
  it('3 focus의 잡이 없으면 job null, noticeId는 focus 것', () => {
    expect(pickTarget([], null, none, focus('N-F', 5, t(5)), 5)).toEqual({ job: null, noticeId: 'N-F' });
  });
  it('다른 탭의 focus는 무시', () => {
    const run = job('r', { noticeId: 'N-R', status: 'running', originTabId: 9 });
    expect(pickTarget([run], null, none, focus('N-F', 7, t(5)), 5).job).toBe(run);
  });
  it('4 아무 진행 중 잡', () => {
    const run = job('r', { noticeId: 'N-R', status: 'running', originTabId: 9 });
    const done = job('d', { noticeId: 'N-D' });
    expect(pickTarget([done, run], null, none, null, 5)).toEqual({ job: run, noticeId: 'N-R' });
  });
  it('5 가장 최근 잡, 없으면 빈 상태', () => {
    const a = job('a', { noticeId: 'N-A' });
    const b = job('b', { noticeId: 'N-B' });
    expect(pickTarget([a, b], null, none, null, 5)).toEqual({ job: a, noticeId: 'N-A' });
    expect(pickTarget([], null, none, null, null)).toEqual({ job: null, noticeId: undefined });
  });
});
