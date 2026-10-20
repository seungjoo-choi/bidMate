import type { AiProvider } from '../types/ai';
import type { AiKey } from './keys';

/** 기본 모델 ID. openai·gemini는 S0 실측 후 채운다(비어 있으면 실행 시 AI_MODEL_MISSING). */
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = { claude: 'claude-sonnet-5-5', openai: '', gemini: 'gemini-3.5-flash' };

/** 키가 없거나 목록을 못 받았을 때 설정 화면 드롭다운에 보이는 추천 모델(2026-10 기준). 첫 항목이 권장. */
export const AI_RECOMMENDED_MODELS: Record<AiProvider, string[]> = {
  claude: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'],
  openai: ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'],
  gemini: ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
};

/** 규칙 동의어(mgmtExclude 제외)에 더해 발췌 키워드로 쓰는 단어. */
export const AI_EXCERPT_EXTRA_KEYWORDS = [
  '차등점수', '배점', '정량평가', '평가항목', '평가기준', '실적', '인정범위', '인정기간', '최근', '이상의', '억원', '천만원', '인정', '신용',
  '공고일', '제출기간', '사업금액', '사업기간', '낙찰자', '예정가격',
];
export const EXCERPT_FILE_MAX_CHARS = 24_000;
export const EXCERPT_MAX_CHARS = 100_000;

/** 대상 항목별 관련도 키워드: RuleSet.synonyms 키 + 추가 단어. 상한 초과 시 이 키워드가 적은 구간부터 뺀다. */
const PERF = ['performance', 'perfAnchor'];
export const AI_FOCUS_KEYWORDS: Record<AiKey, { synonymKeys: string[]; words: string[] }> = {
  credibilityScore: { synonymKeys: ['credibility'], words: [] },
  managementScore: { synonymKeys: ['management'], words: ['경영상태'] },
  performanceScore: { synonymKeys: PERF, words: ['실적', '배점'] },
  performancePeriod: { synonymKeys: PERF, words: ['실적', '인정기간', '최근', '년 이내', '년간'] },
  performanceMinAmount: { synonymKeys: PERF, words: ['실적', '억원', '천만원', '백만원', '이상의', '금액', '규모'] },
  performanceCondition: { synonymKeys: PERF, words: ['실적', '인정범위', '인정'] },
  differentialScoring: { synonymKeys: [], words: ['차등점수', '차등'] },
  postedAt: { synonymKeys: [], words: ['공고일', '게시', '공고일시'] },
  registrationDeadline: { synonymKeys: [], words: ['참가자격', '등록마감', '참가등록'] },
  proposalPeriod: { synonymKeys: [], words: ['제출기간', '제안서 제출', '입찰서 제출', '접수'] },
  proposalEvalAt: { synonymKeys: [], words: ['평가일', '평가 일시', '발표평가', '평가위원회'] },
  budgetAmount: { synonymKeys: [], words: ['사업금액', '사업예산', '총사업비', '배정예산', '추정가격'] },
  projectPeriod: { synonymKeys: [], words: ['사업기간', '용역기간', '계약기간', '과업기간'] },
  evalMethod: { synonymKeys: [], words: ['낙찰자 결정', '협상에 의한', '적격심사', '기술평가', '가격평가'] },
  jointVentureAllowed: { synonymKeys: [], words: ['공동수급', '공동계약', '컨소시엄', '공동이행', '분담이행'] },
  priceMethod: { synonymKeys: [], words: ['예정가격', '예가', '복수예비가격'] },
};

/** API 실행 시 문서 전문 전송 상한(총 글자 수). 넘으면 발췌 전송으로 폴백한다. */
/** API 전문 전송 상한(글자). 실측 약 2자/토큰 → 약 12.5만 토큰으로 Claude 200k 컨텍스트·무료 등급 분당 토큰 한도 안에 둔다. */
export const API_FULLTEXT_MAX_CHARS = 250_000;
/** 발췌 v2: 섹션 머리 줄(□ ○ 가. 1. 제N조 [별표 N] [별지 N] 등). 표 밖 줄에만 적용한다. */
export const SECTION_HEAD_RE = /^\s*(?:[□■○●◆◇▣]|[가-힣]\.\s|\d{1,2}\.\s|제\s*\d+\s*[조장절]|\[?\s*별표\s*\d|\[?\s*별지\s*\d)/;
/** 적중 구간을 소속 섹션 전체로 넓힐 때의 섹션 상한(글자 수) */
export const SECTION_MAX_CHARS = 6_000;
/** 표 끝 뒤에 붙는 주석 줄(※ * ** *** 주N)) */
export const NOTE_LINE_RE = /^\s*(?:※|\*{1,3}(?!\*)|주\s*\d+\s*\))/;
/** 참조어 추적 창: 어구가 든 줄 기준 앞·뒤 줄 수, 어구당 최대 추가 개수 */
export const REF_WINDOW_BEFORE = 2;
export const REF_WINDOW_AFTER = 8;
export const REF_MAX_HITS = 8;
