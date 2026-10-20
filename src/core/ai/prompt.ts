import { EXTRACTION_KEYS, type ExtractionKey } from '../types/extraction';
import { AI_SCHEMA_TAG, type OutputSpec } from '../types/ai';

export const PROMPT_VERSION = '1.0.0';
export const REQUEST_MARKER = (runId: string): string => `<<BIDMATE-AI-REQUEST runId=${runId} v=${PROMPT_VERSION}>>`;

export interface ItemDef { name: string; valueFormat: string; description: string; hints: string[]; pitfalls: string[] }

const SCORE_PITFALLS = [
  '0점은 배점이 아니다.',
  '등급별 점수표 행(AAA, BBB- 등)은 배점이 아니다.',
  '소계 행과 "수행실적 및 경영상태 4점"처럼 묶어 쓴 문장은 값이 아니다.',
  '질의답변에서 찾은 값은 note에 "질의답변"이라고 적는다.',
];

export const ITEM_DEFS: Record<ExtractionKey, ItemDef> = {
  credibilityScore: {
    name: '신용평가 배점',
    valueFormat: 'number (0~1000, 점 단위)',
    description: '정량평가표에서 신용(신용평가등급) 항목에 배정된 만점 배점.',
    hints: ['평가항목표의 "신용", "신용평가" 행의 배점 칸'],
    pitfalls: SCORE_PITFALLS,
  },
  managementScore: {
    name: '경영상태 배점',
    valueFormat: 'number (0~1000, 점 단위)',
    description: '정량평가표에서 경영상태 항목에 배정된 만점 배점.',
    hints: ['평가항목표의 "경영상태" 행의 배점 칸'],
    pitfalls: [...SCORE_PITFALLS, '제재·입찰참가제한 행은 경영상태 배점이 아니다.'],
  },
  performanceScore: {
    name: '수행실적 배점',
    valueFormat: 'number (0~1000, 점 단위)',
    description: '정량평가표에서 수행실적(유사 사업 수행실적) 항목에 배정된 만점 배점.',
    hints: ['평가항목표의 "수행실적", "실적" 행의 배점 칸'],
    pitfalls: SCORE_PITFALLS,
  },
  performancePeriod: {
    name: '실적 인정기간',
    valueFormat: 'string ("N년" 형식, 예: "5년")',
    description: '수행실적으로 인정하는 최근 기간.',
    hints: ['"최근 N년간", "공고일 기준 N년 이내" 등 인정기간 문구'],
    pitfalls: ['창업기업 예외 기간은 인정기간이 아니다.', '질의답변에서 찾은 값은 note에 "질의답변"이라고 적는다.'],
  },
  performanceMinAmount: {
    name: '실적 인정금액',
    valueFormat: 'number (원 단위 정수, 예: 500000000)',
    description: '수행실적으로 인정하는 최소 계약 금액(이상 기준).',
    hints: ['"계약금액 N억원 이상" 등 인정금액 문구'],
    pitfalls: [
      '금액 구간별 점수표("10억원 이상: 3")는 인정금액이 아니다.',
      '추정가격·기초금액은 인정금액이 아니다.',
      '질의답변에서 찾은 값은 note에 "질의답변"이라고 적는다.',
    ],
  },
  performanceCondition: {
    name: '실적 인정 조건',
    valueFormat: 'string (원문 그대로, 2000자 이하)',
    description: '수행실적 인정 범위·조건을 설명하는 원문 문장.',
    hints: ['"인정범위", "인정 실적" 아래의 조건 문장'],
    pitfalls: ['요약하거나 바꿔 쓰지 말고 원문 그대로 옮긴다.', '질의답변에서 찾은 값은 note에 "질의답변"이라고 적는다.'],
  },
  differentialScoring: {
    name: '차등점수제 적용 여부',
    valueFormat: 'boolean (true=적용, false=미적용)',
    description: '정량평가에 차등점수제를 적용하는지 여부.',
    hints: ['"차등점수제", "차등점수" 문구와 그 적용 여부'],
    pitfalls: ['"차등점수제를 적용한 경우"라는 조건 문장이나 "적용 대상이 아님"은 적용으로 보지 않는다.'],
  },
};

const KIND_OF: Record<ExtractionKey, 'number' | 'string' | 'boolean'> = {
  credibilityScore: 'number', managementScore: 'number', performanceScore: 'number',
  performancePeriod: 'string', performanceMinAmount: 'number', performanceCondition: 'string', differentialScoring: 'boolean',
};

export const SYSTEM_PROMPT = [
  '당신은 공공입찰 첨부문서의 정량평가 기준을 검토하는 검토자입니다.',
  '- 아래 "문서 발췌"에 있는 내용만 근거로 삼으세요. 추정·계산·외부 지식은 금지입니다.',
  '- 찾지 못한 항목은 value를 null, quote를 ""로 두세요.',
  '- quote는 발췌의 글자 그대로 옮기세요. 한 줄 또는 표의 한 행, 300자 이내이며 바꿔 쓰기·요약은 금지입니다.',
  '- file은 발췌 머리글(=== 파일: … ===)의 파일명 그대로, page는 `[p N]`의 N(없으면 null)입니다.',
  '- 값이 여럿이면 평가기준표의 값을 value에 쓰고 나머지는 note에 적으세요.',
  '- 요청한 항목 외의 key는 쓰지 마세요.',
  '- JSON 외의 텍스트는 쓰지 마세요.',
  '- 출력의 schema와 runId는 요청에 적힌 값을 그대로 되돌리세요.',
].join('\n');

export interface BuildPromptInput { runId: string; keys: ExtractionKey[]; excerpt: string; skippedFiles: string[] }
export interface BuiltPrompt { system: string; user: string; manualText: string; spec: OutputSpec }

/** 기존 추출값·후보·수정값·확인 필요 사유는 입력으로 받지도 넣지도 않는다(앵커링 방지). */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const keys = EXTRACTION_KEYS.filter((k) => input.keys.includes(k));
  const spec: OutputSpec = { tag: AI_SCHEMA_TAG, runId: input.runId, keys, kindOf: { ...KIND_OF } };
  const defs = keys.map((k) => {
    const d = ITEM_DEFS[k];
    return [
      `### ${k} (${d.name})`,
      `- 값 형식: ${d.valueFormat}`,
      `- 설명: ${d.description}`,
      ...d.hints.map((h) => `- 힌트: ${h}`),
      ...d.pitfalls.map((p) => `- 주의: ${p}`),
    ].join('\n');
  }).join('\n\n');
  const example = {
    schema: AI_SCHEMA_TAG, runId: input.runId,
    items: [{ key: keys[0] ?? 'credibilityScore', value: null, quote: '', file: null, page: null, note: '' }],
  };
  const user = [
    `## 요청 항목 (key는 아래 ${keys.length}개만 허용: ${keys.join(', ')})`,
    defs,
    '## 출력 형식',
    `schema는 "${AI_SCHEMA_TAG}", runId는 "${input.runId}"로 고정합니다. items에는 요청 항목마다 하나씩 넣으세요.`,
    JSON.stringify(example, null, 2),
    '## 문서 발췌',
    input.excerpt,
  ].join('\n\n');
  const skipped = input.skippedFiles.length
    ? `\n\n다음 파일은 글자를 읽을 수 없어 제외했습니다. 필요하면 원본을 대화에 직접 첨부하세요: ${input.skippedFiles.join(', ')}`
    : '';
  const manualText = `${REQUEST_MARKER(input.runId)}\n${SYSTEM_PROMPT}\n\n${user}${skipped}\n\n답은 \`\`\`json 코드 블록 하나로 주세요.`;
  return { system: SYSTEM_PROMPT, user, manualText, spec };
}
