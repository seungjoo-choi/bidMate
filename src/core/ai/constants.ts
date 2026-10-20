import type { AiProvider } from '../types/ai';

/** 기본 모델 ID. openai·gemini는 S0 실측 후 채운다(비어 있으면 실행 시 AI_MODEL_MISSING). */
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = { claude: 'claude-sonnet-5-5', openai: '', gemini: 'gemini-3.5-flash' };

/** 규칙 동의어(mgmtExclude 제외)에 더해 발췌 키워드로 쓰는 단어. */
export const AI_EXCERPT_EXTRA_KEYWORDS = [
  '차등점수', '배점', '정량평가', '평가항목', '평가기준', '실적', '인정범위', '인정기간', '최근', '이상의', '억원', '천만원', '인정', '신용',
];
export const EXCERPT_FILE_MAX_CHARS = 16_000;
export const EXCERPT_MAX_CHARS = 48_000;
