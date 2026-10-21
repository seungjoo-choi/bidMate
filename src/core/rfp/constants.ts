// RFP 비교 임계값. 2026-10-21 실측(전자출하 HWP ↔ 축산물원패스 HWPX) 기준, 실문서로 계속 보정한다.

/** 번호가 같을 때 짝으로 인정하는 최소 유사도(명칭 또는 본문 중 하나만 넘어도 인정) */
export const ID_ACCEPT_NAME = 0.5;
export const ID_ACCEPT_BODY = 0.4;
/** 번호로 짝지었어도 명칭·본문이 모두 이 아래면 '다른 항목일 수도'(weak) */
export const WEAK_NAME = 0.7;
export const WEAK_BODY = 0.4;
/**
 * 같은 번호 가산점. 번호만 같고 내용이 다른 짝보다 내용이 같은 다른 번호 짝이 이기도록 작게 둔다
 * (실측: 출연연 NFIS COR-003 삭제로 특수조건(1)·(2) 번호가 당겨진 경우).
 */
export const ID_BONUS = 0.15;
/** 번호가 다를 때 내용 유사도 짝 기준 */
export const PAIR_THRESHOLD = 0.6;
export const W_NAME = 0.6;
export const W_BODY = 0.4;
export const PREFIX_BONUS = 0.1;
/** 분할/병합: 남은 항목 본문이 상대 항목에 포함된 비율 */
export const CONTAIN_THRESHOLD = 0.6;
export const CONTAIN_MIN_CHARS = 20;
/** 본문 유사도가 이 아래면 대폭 변경(major), 이 위면 몇 글자 바뀜(minor) */
export const MAJOR_BODY = 0.5;
export const MINOR_BODY = 0.97;
/** 줄 diff에서 '고친 줄'로 짝짓는 최소 유사도 */
export const LINE_PAIR = 0.5;
/** 고친 줄 짝짓기를 시도하는 묶음 크기 상한(빠진 줄 수 × 새 줄 수) */
export const LINE_PAIR_MAX = 10_000;
/** 글자 단위 재세분 대상 교체 구간 최대 길이 */
export const FINE_MAX_CHARS = 30;
/** LCS 표 크기 상한(넘으면 통째 교체로 본다) */
export const LCS_MAX_CELLS = 4_000_000;
/** 문단형 세부내용 상한 */
export const PARA_DETAIL_MAX = 2000;

export const RFP_UPLOAD_MAX_MB = 20;
export const AI_INPUT_MAX_CHARS = 60_000;
export const AI_ITEM_MAX_CHARS = 1_500;
