export type ProgressState = 'active' | 'ok' | 'warn' | 'error';
export type ProgressActionId = 'retry' | 'grant' | 'open-mail' | 'open-review' | 'open-notice' | 'settings' | 'sidepanel' | 'choose-dashboard' | 'choose-compose';
export interface ProgressAction { id: ProgressActionId; label: string }
export interface ProgressItem {
  key: string;
  title: string;
  phase: 'collect' | 'compose' | 'eval';
  state: ProgressState;
  stepLabel: string;
  /** active에서만. 진행 중 단계 id(COLLECT_STEP_LABEL, COMPOSE_STEP_LABEL의 키). 카드가 단계 아이콘을 고르는 데 쓴다 */
  stepId?: string;
  detail?: string;
  /** active에서만 0..1 */
  ratio?: number;
  /** active에서만. 진행 중 단계가 ratio에서 차지하는 몫(단계 무게 기준). 진행률이 없는 단계 동안 카드가 막대를 조금씩 채우는 데 쓴다 */
  stepSpan?: number;
  /** force: 취소 중일 때 '강제 중단' 버튼을 보인다. on.force 콜백 필요 */
  cancel?: { target: 'collect' | 'compose'; cancelling: boolean; force?: boolean };
  /** 끝났지만 사용자의 완료 후 선택을 기다리는 항목(자동 소멸 제외) */
  awaiting?: true;
  /** 끝난 항목에서만. 행의 주 버튼과 같은 동작(메일 보기·검수·다시 시도 등) */
  actions?: ProgressAction[];
}
export type ProgressPanelView =
  | { kind: 'hidden' }
  | { kind: 'pill'; text: string; activeCount: number }
  | { kind: 'card'; headline: string; items: ProgressItem[]; moreCount: number; activeCount: number; settledCount: number };
