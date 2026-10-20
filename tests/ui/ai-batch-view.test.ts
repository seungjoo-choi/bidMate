import { describe, expect, it } from 'vitest';
import type { AiBatchItem, AiBatchState } from '../../src/core/types/ai';
import {
  barCells, batchActive, batchBlockReason, batchCounts, batchModeNote, needsPaidConfirm, paidConfirmText, currentNoticeId, finishText, headerToggle, itemReasonLabel, itemResult, progressIndex,
  retryTargets, selectableForAi, stopReasonText, waitSeconds,
} from '../../src/ui/review/ai-batch-view';

const item = (noticeId: string, status: AiBatchItem['status'], over: Partial<AiBatchItem> = {}): AiBatchItem => ({ noticeId, status, attempts: 1, ...over });
const state = (items: AiBatchItem[], over: Partial<AiBatchState> = {}): AiBatchState => ({
  batchId: 'b', provider: 'gemini', model: 'm', status: 'running', startedAt: 't', updatedAt: 't', items, ...over,
});

describe('selectableForAi', () => {
  const e = (extractionStatus: string | undefined, kind?: 'prespec') => ({ noticeId: 'n', extractionStatus, ...(kind ? { kind } : {}) }) as never;
  it('입찰공고 + verified·needs_review만 선택 가능', () => {
    expect(selectableForAi(e('verified')).ok).toBe(true);
    expect(selectableForAi(e('needs_review')).ok).toBe(true);
  });
  it('사전규격·미분석·실패·분석 불가는 사유와 함께 불가', () => {
    expect(selectableForAi(e('verified', 'prespec'))).toEqual({ ok: false, reason: '사전규격은 AI 재검토 대상이 아닙니다' });
    expect(selectableForAi(e('not_run'))).toEqual({ ok: false, reason: '평가정보 미분석' });
    expect(selectableForAi(e(undefined))).toEqual({ ok: false, reason: '평가정보 미분석' });
    expect(selectableForAi(e('failed'))).toEqual({ ok: false, reason: '추출 실패' });
    expect(selectableForAi(e('unsupported'))).toEqual({ ok: false, reason: '분석 불가' });
  });
});

describe('headerToggle', () => {
  it('보이는 선택 가능 행이 모두 선택되지 않았으면 전부 선택, 모두 선택됐으면 그것만 해제(안 보이는 선택은 유지)', () => {
    const a = headerToggle(['a', 'b'], new Set(['x']));
    expect(a).toMatchObject({ checked: false, indeterminate: false });
    expect([...a.next].sort()).toEqual(['a', 'b', 'x']);
    const b = headerToggle(['a', 'b'], new Set(['a', 'b', 'x']));
    expect(b.checked).toBe(true);
    expect([...b.next]).toEqual(['x']);
  });
  it('일부만 선택이면 indeterminate이고 토글하면 전부 선택', () => {
    const t = headerToggle(['a', 'b', 'c'], new Set(['a']));
    expect(t).toMatchObject({ checked: false, indeterminate: true });
    expect([...t.next].sort()).toEqual(['a', 'b', 'c']);
  });
  it('보이는 선택 가능 행이 없으면 체크 아님·변화 없음', () => {
    const t = headerToggle([], new Set(['x']));
    expect(t).toMatchObject({ checked: false, indeterminate: false });
    expect([...t.next]).toEqual(['x']);
  });
});

describe('사유·결과 라벨', () => {
  const err = (code: string, message = 'm'): Pick<AiBatchItem, 'error'> => ({ error: { code, message } });
  it('알려진 코드는 명세 문구, 그 외는 code와 message', () => {
    expect(itemReasonLabel(err('JOB_ALREADY_RUNNING'))).toBe('추출 중');
    expect(itemReasonLabel(err('AI_RUN_BUSY'))).toBe('AI 실행·대기 중');
    expect(itemReasonLabel(err('AI_ALREADY_RAN'))).toBe('배치 중 직접 실행됨');
    expect(itemReasonLabel(err('NOT_FOUND'))).toBe('추출 결과 없음');
    expect(itemReasonLabel(err('NO_DOCUMENTS'))).toBe('읽을 문서 없음');
    expect(itemReasonLabel(err('AI_BATCH_STOPPED'))).toBe('중단으로 미실행');
    expect(itemReasonLabel(err('AI_BATCH_CANCELLED'))).toBe('취소');
    expect(itemReasonLabel(err('AI_TIMEOUT', '시간 초과'))).toBe('AI_TIMEOUT 시간 초과');
    expect(itemReasonLabel({})).toBe('');
  });
  it('공고별 결과: 완료는 제안·일치(+못 찾음·검증 실패는 있을 때만), 건너뜀·실패는 사유', () => {
    expect(itemResult(item('a', 'done', { summary: { match: 3, proposals: 2, none: 0, rejected: 0 } }))).toEqual({ text: '제안 2 · 일치 3', tone: 'ok' });
    expect(itemResult(item('a', 'done', { summary: { match: 0, proposals: 1, none: 1, rejected: 2 } }))).toEqual({ text: '제안 1 · 일치 0 · 못 찾음 1 · 검증 실패 2', tone: 'ok' });
    expect(itemResult(item('a', 'skipped', { error: { code: 'JOB_ALREADY_RUNNING', message: '' } }))).toEqual({ text: '건너뜀 · 추출 중', tone: 'muted' });
    expect(itemResult(item('a', 'failed', { error: { code: 'AI_QUOTA', message: '한도' } }))).toEqual({ text: 'AI_QUOTA 한도', tone: 'bad' });
    expect(itemResult(item('a', 'running')).tone).toBe('muted');
  });
});

describe('진행 집계', () => {
  const s = state([item('a', 'done'), item('b', 'done'), item('c', 'skipped'), item('d', 'running'), item('e', 'queued'), item('f', 'queued')], { currentIndex: 3 });
  it('집계·진행 위치(끝난 것 + 진행 중 1)·칸 막대', () => {
    expect(batchCounts(s)).toEqual({ done: 2, failed: 0, skipped: 1, running: 1, queued: 2, total: 6 });
    expect(progressIndex(s)).toBe(4);
    expect(barCells(s)).toEqual(['done', 'done', 'skip', 'run', 'queued', 'queued']);
    expect(currentNoticeId(s)).toBe('d');
  });
  it('waiting이면 현재 공고(실패한 시도)를 진행 중 칸으로, 대기 초는 올림', () => {
    const w = state([item('a', 'failed', { error: { code: 'AI_RATE_LIMIT', message: '' } }), item('b', 'queued')], { status: 'waiting', currentIndex: 0, waitUntil: new Date(10_500).toISOString() });
    expect(barCells(w)).toEqual(['run', 'queued']);
    expect(waitSeconds(w, 0)).toBe(11);
    expect(waitSeconds(w, 10_000)).toBe(1);
    expect(waitSeconds(w, 99_000)).toBe(0);
    expect(waitSeconds(s, 0)).toBe(0);
  });
  it('종료 상태에서는 현재 공고가 없고 batchActive는 running·waiting만 참', () => {
    const done = state([item('a', 'done')], { status: 'done', currentIndex: 0 });
    expect(currentNoticeId(done)).toBeUndefined();
    expect(batchActive(done)).toBe(false);
    expect(batchActive(s)).toBe(true);
    expect(batchActive(state([], { status: 'waiting' }))).toBe(true);
    expect(batchActive(null)).toBe(false);
  });
  it('종료 문구', () => {
    const items = [item('a', 'done'), item('b', 'failed'), item('c', 'skipped')];
    expect(finishText(state(items, { status: 'done' }))).toBe('완료 · 완료 1 · 실패 1 · 건너뜀 1');
    expect(finishText(state(items, { status: 'stopped' }))).toBe('중단됨 · 완료 1 · 실패 1 · 건너뜀 1');
    expect(finishText(state(items, { status: 'cancelled' }))).toBe('취소됨 · 완료 1 · 실패 1 · 건너뜀 1');
  });
});

describe('재실행 대상·중단 안내', () => {
  it('AI_BATCH_STOPPED로 건너뛴 항목과 queued만(취소·다른 사유 건너뜀·실패는 제외)', () => {
    const s = state([
      item('a', 'done'), item('b', 'failed', { error: { code: 'AI_QUOTA', message: '' } }),
      item('c', 'skipped', { error: { code: 'AI_BATCH_STOPPED', message: '' } }), item('d', 'skipped', { error: { code: 'AI_BATCH_CANCELLED', message: '' } }),
      item('e', 'skipped', { error: { code: 'JOB_ALREADY_RUNNING', message: '' } }), item('f', 'queued', { attempts: 0 }),
    ]);
    expect(retryTargets(s)).toEqual(['c', 'f']);
  });
  it('중단 사유 안내', () => {
    expect(stopReasonText({ stopReason: { code: 'AI_QUOTA', message: '' } })).toContain('한도');
    expect(stopReasonText({ stopReason: { code: 'AI_AUTH', message: '' } })).toContain('키');
    expect(stopReasonText({ stopReason: { code: 'AI_X', message: '설명' } })).toBe('AI_X 설명');
    expect(stopReasonText({})).toBe('');
  });
});

describe('batchBlockReason', () => {
  it('진행 중·읽는 중·키 없음·모델 없음이면 막고, 설정 문제만 setup', () => {
    expect(batchBlockReason({ hasKey: true, model: 'm', active: true })).toEqual({ text: '일괄 실행이 진행 중입니다', setup: false });
    expect(batchBlockReason({ hasKey: null, model: 'm', active: false })).toEqual({ text: '설정을 불러오는 중', setup: false });
    expect(batchBlockReason({ hasKey: false, model: 'm', active: false, providerLabel: 'Gemini' })).toEqual({ text: '일괄 실행은 API 방식만 지원합니다. 설정에서 Gemini 키를 저장하세요', setup: true });
    expect(batchBlockReason({ hasKey: true, model: ' ', active: false, providerLabel: 'Claude' })).toEqual({ text: '일괄 실행은 API 방식만 지원합니다. 설정에서 Claude 모델을 선택하세요', setup: true });
    expect(batchBlockReason({ hasKey: false, model: 'm', active: false })?.text).toContain('공급자 키를 저장하세요');
    expect(batchBlockReason({ hasKey: true, model: undefined, active: false })).toMatchObject({ setup: true });
  });
  it('키·모델이 있고 진행 중이 아니면 null', () => {
    expect(batchBlockReason({ hasKey: true, model: 'gemini-3.5-flash', active: false })).toBeNull();
  });
});

describe('일괄은 API 전용 안내', () => {
  it('설정이 반자동일 때만 안내 문구', () => {
    expect(batchModeNote('manual')).toBe('일괄 실행은 API 방식으로 진행됩니다(설정: 프롬프트 복사)');
    expect(batchModeNote('api')).toBeNull();
    expect(batchModeNote(undefined)).toBeNull();
  });
  it('유료 공급자(Claude·OpenAI) + 반자동 설정일 때만 실행 전 확인', () => {
    expect(needsPaidConfirm('claude', 'manual')).toBe(true);
    expect(needsPaidConfirm('openai', 'manual')).toBe(true);
    expect(needsPaidConfirm('gemini', 'manual')).toBe(false);
    expect(needsPaidConfirm('claude', 'api')).toBe(false);
    expect(needsPaidConfirm('openai', undefined)).toBe(false);
    expect(paidConfirmText(3)).toBe('유료 API로 3건 실행합니다');
  });
});
