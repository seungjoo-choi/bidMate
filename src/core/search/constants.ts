import { API_FULLTEXT_MAX_CHARS } from '../ai/constants';

/** 질의 최소 길이(정규화 후 항 하나당). */
export const SEARCH_MIN_QUERY_CHARS = 2;
/** 문서 하나에서 보관하는 최대 적중 수. 넘는 적중은 개수만 센다. */
export const SEARCH_MAX_HITS_PER_DOC = 300;
export const SEARCH_SNIPPET_CHARS = 160;
/** 항·구문 하나당 강조 위치 최대 수. */
export const SEARCH_MAX_SPANS_PER_TERM = 20;

/** 상세화면 전문 상한(자). */
export const DETAIL_TEXT_MAX_CHARS = 300_000;
/** notice/texts 응답 총합 상한(자). */
export const NOTICE_TEXTS_MAX_CHARS = 4_000_000;

export const ASK_CONTEXT_MAX_CHARS = 40_000;
export const ASK_FILE_MAX_CHARS = 15_000;
export const ASK_FULL_MAX_CHARS = API_FULLTEXT_MAX_CHARS;
export const ASK_MAX_TOKENS = 4_096;
export const ASK_QUESTION_MAX_CHARS = 500;
export const ASK_MAX_RECORDS = 30;
export const ASK_MAX_CITATIONS = 12;
export const ASK_TIMEOUT_MS = 150_000;
export const ASK_DASHBOARD_TIMEOUT_MS = 160_000;
/** 질문 항 끝에서 떼어내는 조사·의문 어미(긴 것부터 비교한다). 항 전체가 이 목록의 말이면 항에서 뺀다. */
export const ASK_STOPWORDS = [
  '어떻게', '인가요', '이야', '인가', '얼마', '언제', '까지', '부터', '뭐', '몇', '은', '는', '이', '가', '을', '를', '의', '에', '로',
  '이에요', '입니까', '인지', '나요', '죠', '요',
];
/** 어미 제거에서 제외하는 낱말(끝 글자가 조사처럼 보이지만 낱말의 일부). */
export const ASK_KEEP_WORDS = ['사전협의', '예정가', '공급가', '추정가', '낙찰가', '기초가', '사전가격', '협의'];
/** 질문 컨텍스트 창: 표 밖 유닛은 앞 4줄·뒤 12줄. 표 행 유닛은 표 전체(최대 150줄, excerpt TABLE_MAX_LINES와 같음). */
export const ASK_WINDOW_BEFORE = 4;
export const ASK_WINDOW_AFTER = 12;
export const ASK_TABLE_MAX_LINES = 150;
/** 적중이 없을 때 문서마다 보내는 앞쪽 줄 수(excerpt NO_KEYWORD_LINES와 같음). */
export const ASK_NO_HIT_LINES = 60;
