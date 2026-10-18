/** 신뢰할 수 없는 문서에서 표 크기가 폭발하지 않도록 파서/Grid가 공통으로 쓰는 상한. */
export const MAX_TABLE_ROWS = 2000;
export const MAX_TABLE_COLS = 256;
/** 표 하나의 행×열 면적, 셀 하나의 rowSpan×colSpan 면적 상한. 넘으면 잘라 내고 warning을 남긴다. */
export const MAX_TABLE_AREA = 20000;
/** 압축 해제 총량 상한(HWP 섹션, zip 엔트리 공통). */
export const MAX_INFLATE_BYTES = 200 * 1024 * 1024;
