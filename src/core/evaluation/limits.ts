/** 평가 점수 수집의 대기 시간. SW(eval-collector)와 대시보드가 함께 쓴다. */
export const EVAL_TAB_LOAD_WAIT_MS = 20_000;
export const EVAL_RETRY_MS = 700;
export const EVAL_RETRY_MAX_MS = 15_000;
/** CS의 전체 제한(60초)보다 길게 둔다. */
export const EVAL_FETCH_WAIT_MS = 70_000;

/** 한 건의 최악 경로(탭 로딩 + 수신자 재시도 + 응답 대기)에 앞선 FIFO 1건과 여유 10초를 더한 UI 대기 시간 */
export const EVAL_PROBE_UI_TIMEOUT_MS = 2 * (EVAL_TAB_LOAD_WAIT_MS + EVAL_RETRY_MAX_MS + EVAL_FETCH_WAIT_MS) + 10_000;

/** 저장(offscreen eval/save) 대기 */
export const EVAL_SAVE_WAIT_MS = 30_000;
/** 저장까지 하는 eval/collect의 UI 대기 시간 */
export const EVAL_COLLECT_UI_TIMEOUT_MS = EVAL_PROBE_UI_TIMEOUT_MS + EVAL_SAVE_WAIT_MS;
