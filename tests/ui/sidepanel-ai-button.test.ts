import { describe, expect, it } from 'vitest';
import { aiButtonView, type AiButtonInput } from '../../src/entrypoints/sidepanel/ai-button';

const base: AiButtonInput = { quick: { phase: 'idle', label: '' }, mode: 'api', parsedCount: 2, jobActive: false, hasKey: true, hasModel: true };
const v = (o: Partial<AiButtonInput>) => aiButtonView({ ...base, ...o });

describe('aiButtonView', () => {
  it('idle·api: 실행 가능', () => {
    expect(v({})).toMatchObject({ kind: 'run', label: 'AI로 찾기', disabled: false });
  });
  it('idle·api: parsed 0이면 비활성, 수집 잡 진행 중이면 비활성', () => {
    expect(v({ parsedCount: 0 })).toMatchObject({ kind: 'run', disabled: true });
    expect(v({ jobActive: true })).toMatchObject({ kind: 'run', disabled: true });
  });
  it('idle·api: 키 또는 모델 없으면 설정 필요, 읽는 중이면 비활성', () => {
    expect(v({ hasKey: false })).toMatchObject({ kind: 'setup', label: '설정', message: '설정 필요' });
    expect(v({ hasModel: false })).toMatchObject({ kind: 'setup' });
    expect(v({ hasKey: null })).toMatchObject({ kind: 'run', disabled: true });
    expect(v({ mode: undefined })).toMatchObject({ kind: 'run', disabled: true });
  });
  it('idle·manual: 대시보드로 이동 버튼(키 무관), parsed 0이면 비활성', () => {
    expect(v({ mode: 'manual', hasKey: false })).toMatchObject({ kind: 'manual', label: '대시보드에서 AI로 찾기', disabled: false });
    expect(v({ mode: 'manual', parsedCount: 0 })).toMatchObject({ kind: 'manual', disabled: true });
  });
  it('running·awaiting·done', () => {
    expect(v({ quick: { phase: 'running', label: 'x' } })).toMatchObject({ kind: 'running', label: '취소', disabled: false });
    expect(v({ quick: { phase: 'awaiting', label: '' } })).toMatchObject({ kind: 'awaiting', label: '대시보드에서 계속' });
    expect(v({ quick: { phase: 'done', label: 'AI 제안 1 · 일치 2 · 못 찾음 0 · 검증 실패 0' } }))
      .toMatchObject({ kind: 'done', label: '대시보드에서 적용', message: 'AI 제안 1 · 일치 2 · 못 찾음 0 · 검증 실패 0' });
  });
  it('failed: 설정 오류는 [설정], 한도는 잠시 후 다시, 그 외는 다시 시도', () => {
    const f = (code: string) => v({ quick: { phase: 'failed', label: 'AI 재검토 실패', error: { code, message: '' } } });
    expect(f('AI_KEY_MISSING')).toMatchObject({ setup: true, label: '설정', message: 'AI_KEY_MISSING' });
    expect(f('AI_RATE_LIMIT')).toMatchObject({ message: 'AI_RATE_LIMIT', note: '잠시 후 다시', label: '', disabled: true });
    expect(f('AI_HTTP')).toMatchObject({ label: '다시 시도', disabled: false, message: 'AI_HTTP' });
  });
});
