import type { AiMode } from '../../core/types/ai';
import { aiErrorText, isLimitError, isSetupError, type QuickView } from '../../ui/review/ai-view';

/** 사이드패널 "평가 기준" AI 버튼·결과 상자의 표시 결정. 순수 함수(UI는 이 결과만 그린다). */
export type AiButtonKind = 'run' | 'manual' | 'setup' | 'running' | 'awaiting' | 'done' | 'failed';
export interface AiButtonInput {
  quick: QuickView;
  /** 설정의 AI 방식. 설정을 아직 못 읽었으면 undefined */
  mode: AiMode | undefined;
  /** 파싱된 문서(parsed + textPath) 수 */
  parsedCount: number;
  /** 이 공고의 수집 잡이 진행 중 */
  jobActive: boolean;
  /** 현재 공급자 키 보유. 읽는 중이면 null */
  hasKey: boolean | null;
  hasModel: boolean;
}
export interface AiButtonView {
  kind: AiButtonKind;
  /** 버튼 라벨(없으면 버튼 없음) */
  label: string;
  disabled: boolean;
  /** 비활성 사유(title) */
  hint?: string;
  /** 결과 상자 문구: done·failed·running·awaiting */
  message?: string;
  /** 문구 아래 덧붙이는 안내(한도 오류) */
  note?: string;
  /** 실패 후 [설정]을 함께 보인다 */
  setup?: boolean;
}

export function aiButtonView(i: AiButtonInput): AiButtonView {
  const { quick: q } = i;
  if (q.phase === 'running') return { kind: 'running', label: '취소', disabled: false, message: 'AI 찾는 중' };
  if (q.phase === 'awaiting') return { kind: 'awaiting', label: '대시보드에서 계속', disabled: false, message: 'AI 답변 붙여넣기 대기 중' };
  if (q.phase === 'done') return { kind: 'done', label: '대시보드에서 적용', disabled: false, message: q.label };
  if (q.phase === 'failed') {
    const code = q.error?.code;
    const text = q.error ? aiErrorText(code, q.error.message) || q.label : q.label;
    if (isSetupError(code)) return { kind: 'failed', label: '설정', disabled: false, message: text, setup: true };
    if (isLimitError(code)) return { kind: 'failed', label: '', disabled: true, message: text, note: '잠시 후 다시' };
    return { kind: 'failed', label: '다시 시도', disabled: i.mode !== 'api' || i.jobActive || i.hasKey !== true || !i.hasModel, message: text };
  }
  // idle
  const blocked = i.parsedCount === 0 ? '읽을 문서가 없습니다' : i.jobActive ? '수집 중입니다' : undefined;
  if (i.mode === 'manual') {
    return { kind: 'manual', label: '대시보드에서 AI로 찾기', disabled: !!blocked, ...(blocked ? { hint: blocked } : {}) };
  }
  if (i.hasKey === false || (i.hasKey === true && !i.hasModel)) return { kind: 'setup', label: '설정', disabled: false, message: '설정 필요' };
  const loading = i.mode === undefined || i.hasKey === null;
  return { kind: 'run', label: 'AI로 찾기', disabled: loading || !!blocked, ...(blocked ? { hint: blocked } : {}) };
}
