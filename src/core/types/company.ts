import type { CreditKind } from './settings';

export const CREDIT_KIND_LABEL: Record<CreditKind, string> = { corporate: '기업신용평가등급', bond: '회사채등급', cp: '기업어음등급' };
export const ATTRIBUTE_PRESETS = ['중소기업', '소기업', '여성기업', '장애인기업', '사회적기업', '벤처기업', '이노비즈', '메인비즈', '청년고용우수', '고용우수기업', '가족친화인증', 'ISO 9001', 'ISO 27001', 'SW 품질인증(GS)', '녹색인증', '기술혁신형 중소기업'] as const;
