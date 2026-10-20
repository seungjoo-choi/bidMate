import { AI_KEYS, type AiKey } from './keys';
import { AI_SCHEMA_TAG, type OutputSpec } from '../types/ai';

export const PROMPT_VERSION = '2.2.0';
export const REQUEST_MARKER = (runId: string): string => `<<BIDMATE-AI-REQUEST runId=${runId} v=${PROMPT_VERSION}>>`;

/** 프롬프트 본문에 허용하는 숫자 토큰(예시 숫자 + 형식 안내용 상수). 린트 테스트가 이 목록 밖의 숫자를 막는다. */
export const PROMPT_EXAMPLE_TOKENS: readonly string[] = ['3.7', '7', '11', '0', '1', '3', '300', '2000'];

export interface ItemDef {
  name: string;
  concept: string;
  howToSpot: string[];
  notThis: string[];
  valueFormat: string;
  multi?: string;
}

const DATETIME_FORMAT = 'string (문서 원문 표기 그대로. 연, 월, 일과 시:분이 모두 있어야 값이며 시각이 없으면 value null, note에 날짜만 적음)';
const NUMBER_FORMAT = 'number (문서에 적힌 점수, (가상 예) 11)';

export const ITEM_DEFS: Record<AiKey, ItemDef> = {
  postedAt: {
    name: '공고게시일시',
    concept: '이 공고가 나라장터에 게시(공고)된 날짜와 시각.',
    howToSpot: ['공고문 머리나 꼬리의 공고일자 줄', '입찰공고 알림 표의 공고일시 칸'],
    notThis: ['입찰서 또는 제안서 마감일시', '사전규격 공개일', '정정공고의 원 공고일(정정공고문이면 정정 게시일)'],
    valueFormat: DATETIME_FORMAT,
  },
  registrationDeadline: {
    name: '입찰참가자격등록 마감',
    concept: '입찰참가자격 등록(또는 입찰참가등록)의 마감 일시.',
    howToSpot: ['입찰참가자격 등록 마감 또는 입찰참가등록 기한 줄', '일정 표의 해당 행'],
    notThis: ['입찰서 또는 제안서 제출 마감', '현장설명회 일시', '공동수급협정서 제출 기한(별도 항목이면 note)'],
    valueFormat: DATETIME_FORMAT,
  },
  proposalPeriod: {
    name: '제안서 제출기간',
    concept: '제안서(협상 공고에서는 입찰서) 전자 제출의 시작과 마감.',
    howToSpot: ['제안서 제출기간, 입찰서 제출기간, 제안서 접수 줄과 일정 표 행'],
    notThis: ['제안서 평가일', '입찰참가자격 등록 마감', '제출 장소나 방법 설명'],
    valueFormat: 'string (원문 표기 그대로, 시작과 끝을 한 줄로)',
    multi: '제출 서류 종류별로 기간이 다르면 조건별 값을 모두 적습니다.',
  },
  proposalEvalAt: {
    name: '제안서 평가일자',
    concept: '제안서 평가(기술평가, 발표평가)가 열리는 일시.',
    howToSpot: ['제안서 평가 일시, 평가위원회 개최, 발표평가 일정 줄'],
    notThis: ['제안서 제출 마감', '가격 개찰 일시', '별도 통보 예정 문구(이 경우 value null, note에 그 문구)'],
    valueFormat: DATETIME_FORMAT,
  },
  budgetAmount: {
    name: '사업금액',
    concept: '이 사업의 사업금액(사업예산, 총 사업비, 배정예산). 부가세 포함 여부가 적혀 있으면 note에 적습니다.',
    howToSpot: ['사업금액, 사업예산, 총사업비, 배정예산 줄 또는 표 칸'],
    notThis: ['추정가격(부가세 제외 기준금액, 별도면 note)', '기초금액, 예정가격', '실적 인정 하한 금액', '연차별 분할 금액(총액이 있으면 총액)'],
    valueFormat: 'string (문서 원문 표기 그대로, (가상 예) 300백만원)',
    multi: '연차별 또는 사업 유형별로 금액이 나뉘고 총액이 없으면 조건별 값을 적고 value는 null입니다.',
  },
  projectPeriod: {
    name: '사업기간',
    concept: '이 사업(용역)의 수행 기간. 계약일부터 몇 개월 또는 시작일과 종료일.',
    howToSpot: ['사업기간, 용역기간, 계약기간, 과업기간, 수행기간 줄과 표 칸'],
    notThis: ['단계별 또는 연차별 기간(총 기간이 있으면 총 기간)', '실적 인정기간', '제안서 제출기간', '하자보수 또는 유지보수 기간'],
    valueFormat: 'string (원문 표기 그대로)',
    multi: '단계별로 나뉘고 총 기간이 없으면 조건별 값을 적습니다.',
  },
  evalMethod: {
    name: '평가방법',
    concept: '낙찰자 결정 방법(협상에 의한 계약, 적격심사, 최저가 등)과 기술 가격 배분 비율이 있으면 그 비율.',
    howToSpot: ['낙찰자 결정 방법, 계약 방법, 평가 방법 줄', '기술평가와 가격평가 배점 비율 문구'],
    notThis: ['평가항목별 배점표 내용', '차등점수제 적용 여부(별도 항목)', '입찰 방식(전자입찰 등 절차 설명)'],
    valueFormat: 'string (원문 표기 그대로, 한 줄로)',
  },
  jointVentureAllowed: {
    name: '공동수급 여부',
    concept: '공동수급(공동계약, 컨소시엄)을 허용하는지와 허용 시 방식(공동이행, 분담이행, 주계약자).',
    howToSpot: ['공동수급 허용, 공동계약 가능, 공동수급체 구성 가능 또는 불가 줄', '공동계약 방식 칸'],
    notThis: ['하도급 허용 여부', '공동수급협정서 제출 절차 설명', '지역업체 참여 의무 비율만 있는 문장(방식 명시 없으면 note)'],
    valueFormat: 'string (문서 원문 표기 그대로. (가상 예) 공동이행방식 허용, 공동수급 불가)',
  },
  priceMethod: {
    name: '예가방법',
    concept: '예정가격 결정 방법(복수예비가격 추첨, 단일 예가, 예가 미작성 등).',
    howToSpot: ['예정가격 결정 방법, 예가 산정, 복수예비가격 줄'],
    notThis: ['낙찰 하한율 숫자만 있는 문장(note에)', '가격평가 산식', '기초금액 자체'],
    valueFormat: 'string (원문 표기 그대로)',
  },
  credibilityScore: {
    name: '대외신인도 배점',
    concept: '정량평가의 "신인도/대외신인도" 항목(제재·표창·고용·사회적기업 등 가점·감점 성격 항목 묶음)의 만점 또는 합계 한도.',
    howToSpot: ['평가항목표의 신인도 행 배점 칸', '가감점 표의 "최대 N점" 한도'],
    notThis: [
      '신용평가등급·경영상태 항목(→ managementScore)',
      '개별 가점·감점 항목의 점수, 감점 수치, 0점',
      '가감점 항목만 있고 합계 한도가 없으면 value null, note에 "가감점 항목만 있고 합계 배점 없음"',
    ],
    valueFormat: NUMBER_FORMAT,
  },
  managementScore: {
    name: '경영상태 배점',
    concept: '입찰자의 재무·신용 상태(신용평가등급, 재무비율 등)를 평가하는 항목의 만점.',
    howToSpot: ['평가항목표의 경영상태 또는 신용평가등급 행 배점 칸', '하위 항목이 여럿이면 부문 소계를 값으로 씁니다'],
    notThis: [
      '등급별 평점표의 개별 점수(환산표)',
      '신인도 항목',
      '입찰참가제한·제재',
      '수행실적과 묶인 합산 행(분리할 수 없으면 value null, note에 사유)',
    ],
    valueFormat: NUMBER_FORMAT,
  },
  performanceScore: {
    name: '수행실적 배점',
    concept: '입찰 회사(공동수급체)의 유사사업 수행실적 항목의 만점.',
    howToSpot: ['평가항목표의 수행실적 행 배점 칸'],
    notThis: [
      '투입인력·핵심인력의 경력·실적 점수',
      '실적 구간별 점수(구간 최고점이 배점과 같아도 배점 칸을 인용)',
      '소계, 여러 항목을 묶어 쓴 문장',
    ],
    valueFormat: NUMBER_FORMAT,
  },
  performancePeriod: {
    name: '실적 인정기간',
    concept: '실적의 수행(완료) 시점이 공고일·입찰일 기준 얼마 이내여야 인정되는가.',
    howToSpot: ['"최근 N년", "공고일 기준 N년 이내", "이행완료일이 N년 이내" 같은 표현이 실적 인정·작성 조건 문맥에 있음'],
    notThis: ['창업기업 예외 기간', '본 사업의 과업·계약 기간', '인력 경력 연수', '증빙서류 유효기간'],
    valueFormat: 'string (문서 원문 표기, (가상 예) 7년)',
    multi: '실적 종류별로 기간이 다르면 조건별 값을 모두 적습니다.',
  },
  performanceMinAmount: {
    name: '실적 인정금액',
    concept: '실적 1건이 유사사업 실적으로 인정되기 위한 하한 금액(계약금액·지분금액·건당 기준).',
    howToSpot: ['"N 이상인 사업/실적만 인정", "건당 N 이상" 같은 표현', '유형별 하한 나열'],
    notThis: [
      '(a) 실적 합계를 어떤 기준 금액으로 나눈 비율로 점수를 매길 때의 그 기준 금액(분모). note에 "비율 기준금액 N"으로 적을 수 있음',
      '(b) 금액 구간별 점수표',
      '(c) 추정가격·기초금액·사업예산',
      '(d) 실적 합계 요건(합계 N 이상은 1건 하한이 아니므로 note에만 적음)',
    ],
    valueFormat: 'string (문서 원문 표기, (가상 예) 3.7억원). 금액 요건이 없는 공고는 null',
    multi: '유형·종류별로 하한이 다르면 조건별 값을 모두 적고, 공통 하한이 없으면 value는 null입니다.',
  },
  performanceCondition: {
    name: '실적 인정 조건',
    concept: '유사사업의 정의와 인정·불인정 범위를 서술한 원문.',
    howToSpot: ['"유사사업 :", "실적 인정 범위", "유사사업이란" 아래의 정의 문단(바로 이어진 ※ 주석 포함)'],
    notThis: ['증빙 방법·작성 요령·제출 서류 안내', '평가 방식 설명', '서식의 열 이름'],
    valueFormat: 'string (원문 그대로, 2000자 이내, 정의 문단부터 이어지는 연속 구간. 요약·재배열 금지)',
  },
  differentialScoring: {
    name: '차등점수제 적용 여부',
    concept: '기술(정성)평가 점수에 차등점수제를 적용하는지 여부. "적용한다/적용함/차등점수제(적용)"이 명시되면 true, "미적용/적용하지 않음/해당 없음"이 명시되면 false.',
    howToSpot: ['"차등점수제" 문구와 그 적용 여부 표시'],
    notThis: ['"차등점수제를 적용한 경우에는…" 같은 조건문·일반 규정 인용', '가격점수 차등', '동점 처리', '명시가 없으면 null (false로 추정하지 않음)'],
    valueFormat: 'boolean (true=적용, false=미적용)',
  },
};

const KIND_OF: Record<AiKey, 'number' | 'string' | 'boolean'> = {
  postedAt: 'string', registrationDeadline: 'string', proposalPeriod: 'string', proposalEvalAt: 'string', budgetAmount: 'string',
  projectPeriod: 'string', evalMethod: 'string', jointVentureAllowed: 'string', priceMethod: 'string',
  credibilityScore: 'number', managementScore: 'number', performanceScore: 'number',
  performancePeriod: 'string', performanceMinAmount: 'string', performanceCondition: 'string', differentialScoring: 'boolean',
};

export const SYSTEM_PROMPT = [
  '당신은 공공입찰 공고문과 첨부문서에서 공고 핵심 정보(일정, 금액, 계약 조건)와 정량평가 기준을 찾는 검토자입니다.',
  '[근거]',
  '- 아래 문서에 적힌 내용만 근거로 삼습니다. 추정·계산·외부 지식·일반 관행은 쓰지 않습니다.',
  '- 금액·기간·점수는 문서에 적힌 표기 그대로 씁니다. (가상 예) "3.7억원", "7년". 단위 환산·합산·반올림을 하지 않습니다.',
  '- 날짜는 연, 월, 일, 시:분이 문서에 적힌 표기 그대로 씁니다. 다른 형식으로 바꾸지 않습니다.',
  '[표와 주석]',
  '- 표 셀의 *, **, ※, 주1) 같은 기호는 같은 기호로 시작하는 줄에 정의가 있습니다. 그 줄은 표 바로 아래에도, 같은 문서의 서식·별지 쪽에 멀리 떨어져 있을 수도 있습니다. 표 안 값과 그 주석은 한 몸으로 읽습니다.',
  '- 같은 용어라도 역할이 다를 수 있습니다. 각 항목의 "정의"에 적힌 역할(배점, 하한, 분모, 기간 등)에 맞는 값만 고릅니다. 표 안에 있다는 이유로 고르지 않습니다.',
  '[여러 값]',
  '- 조건(사업 유형, 참가 형태, 공동수급 등)에 따라 값이 다르면 variants에 조건별로 모두 적고, value에는 조건 없이 공통으로 적용되는 값이 있을 때만 그 값을, 없으면 null을 둡니다. 조건이 없으면 variants는 빈 배열입니다.',
  '- 문서 간에 같은 개념의 값이 다르면 우선순위: 질의답변·정정공고 > 평가기준(별표·서식) > 입찰공고문 > 제안요청서 본문 > 참고자료. 채택하지 않은 값과 출처는 note에 적습니다.',
  '- 질의답변에서 찾은 값은 note에 "질의답변"이라고 적습니다.',
  '- 문서에 없으면 value null, quote "". "없다"도 답입니다. 비슷한 항목으로 대신 채우지 않습니다.',
  '[인용]',
  '- quote는 문서의 글자 그대로. 한 줄 또는 표의 한 행, 300자 이내. 줄이 짧으면 바로 위 항목명 줄까지 이어 최대 3줄. 줄 앞 기호도 그대로.',
  '- file은 머리글 "=== 파일: … ===" 이름 그대로, page는 [p N]의 N(없으면 null).',
  '[형식] 요청 항목 외 key 금지, JSON 외 텍스트 금지, schema·runId는 요청 값 그대로.',
].join('\n');

export interface BuildPromptInput { runId: string; keys: AiKey[]; excerpt: string; skippedFiles: string[] }
export interface BuiltPrompt { system: string; user: string; manualText: string; spec: OutputSpec }

/** 기존 추출값·후보·수정값·확인 필요 사유는 입력으로 받지도 넣지도 않는다(앵커링 방지). */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const keys = AI_KEYS.filter((k) => input.keys.includes(k));
  const spec: OutputSpec = { tag: AI_SCHEMA_TAG, runId: input.runId, keys, kindOf: { ...KIND_OF } };
  const defs = keys.map((k) => {
    const d = ITEM_DEFS[k];
    return [
      `### ${k} (${d.name})`,
      `- 정의: ${d.concept}`,
      ...d.howToSpot.map((h) => `- 식별: ${h}`),
      ...d.notThis.map((n) => `- 이것은 아님: ${n}`),
      `- 값 형식: ${d.valueFormat}`,
      ...(d.multi ? [`- 다중값: ${d.multi}`] : []),
    ].join('\n');
  }).join('\n\n');
  const example = {
    schema: AI_SCHEMA_TAG, runId: input.runId,
    items: [{ key: keys[0] ?? 'credibilityScore', value: null, quote: '', file: null, page: null, note: '', variants: [{ condition: '', value: null, quote: '' }] }],
  };
  const user = [
    `## 요청 항목 (key는 아래 ${keys.length}개만 허용: ${keys.join(', ')})`,
    defs,
    '## 출력 형식',
    `schema는 "${AI_SCHEMA_TAG}", runId는 "${input.runId}"로 고정합니다. items에는 요청 항목마다 하나씩 넣으세요. variants는 항목마다 필수이며 조건이 없으면 빈 배열입니다.`,
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
