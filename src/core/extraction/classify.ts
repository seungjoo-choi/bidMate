import type { Attachment } from '../types/notice';

export type DocKind = 'eval_criteria' | 'notice' | 'rfp' | 'qna' | 'other' | 'form' | 'reference';
export interface Classified { kind: DocKind; priority: number /* 1..5, 0=파싱 안 함 */ }
export type SkipReason = 'excluded' | 'duplicate' | 'not_saved' | 'unsupported_ext';
export interface PlannedFile {
  attachment: Attachment; classified: Classified; action: 'parse' | 'skip'; skipReason?: SkipReason;
}

const RULES: Array<[RegExp, Classified]> = [
  [/양식|서식|내역서|투찰/, { kind: 'form', priority: 0 }],
  // 정정공고는 질의회신을 근거로 나와도 공고문 그 자체다.
  [/정정\s*공고/, { kind: 'notice', priority: 2 }],
  // 질의답변은 '제안요청서 질의 답변'처럼 핵심 문서명이 붙어도, '(참고)'가 붙어도 질의답변이다.
  // 핵심 문서로 올리면 답변 값이 1차 근거가 되므로 먼저 판정한다(qna 단독 값은 결정기에서 low_confidence).
  [/질의|답변|Q&A|FAQ/i, { kind: 'qna', priority: 4 }],
  [/규정|지침|예규|일반\s*조건|표준\s*계약|참고|매뉴얼|안내서|설명회/, { kind: 'reference', priority: 0 }],
  [/평가\s*기준|배점|정량\s*평가|평가\s*표|평가\s*항목/, { kind: 'eval_criteria', priority: 1 }],
  // "[공고] …", "[GH공고 제2026-0411호] …", "… 공고 제2026-275호(…)", "건축설계 공모 공고(안)"도 공고문이다.
  [/입찰\s*공고|공고문|공고서|공고\s*제\s*\d|\[[^\]]*공고|공모\s*공고/, { kind: 'notice', priority: 2 }],
  [/제안\s*요청|RFP|과업\s*(내용|지시|설명|이행\s*요청)서|사업\s*설명서/i, { kind: 'rfp', priority: 3 }],
];

const SUPPORTED_EXT = new Set(['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'xlsm', 'txt', 'zip']);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * 파일명으로 문서 종류를 판정한다. 파일명에 공고명이 들어가면("내부규정관리시스템 … 입찰공고문.hwp")
 * 공고명 속 낱말("규정")로 오판하므로, title이 주어지면 공백을 뺀 파일명에서 공고명을 지운 뒤 판정한다.
 */
export function classifyName(fileName: string, title?: string | null): Classified {
  // "제안요청서(계약일반조건 포함)"처럼 묶어 넣은 문서를 밝히는 괄호는 판정에서 뺀다.
  const name = fileName.replace(/[(（][^)）]*포함\s*[)）]/g, ' ');
  // 공고명을 지운 이름으로 먼저 판정하고, 남은 말로 판정이 안 되면(공고명 끝말이 분류어와 겹친 경우) 원래 이름으로 판정한다.
  const stripped = stripTitle(name, title);
  if (stripped !== name) for (const [re, c] of RULES) if (re.test(stripped)) return { ...c };
  for (const [re, c] of RULES) if (re.test(name)) return { ...c };
  return { kind: 'other', priority: 5 };
}

const compactName = (s: string) => s.normalize('NFC').replace(/\s+/g, '');

function stripTitle(name: string, title?: string | null): string {
  const t = title ? compactName(title) : '';
  if (t.length < 4) return name;
  const n = compactName(name);
  return n.includes(t) ? n.split(t).join(' ') : name;
}

/** 확장자를 뺀 이름에서 공백/괄호를 제거한 쌍둥이 판정 키. */
export function twinKey(name: string): string {
  const i = name.lastIndexOf('.');
  return (i < 0 ? name : name.slice(0, i)).normalize('NFC').replace(/[\s()（）[\]]/g, '').toLowerCase();
}

export function planFiles(attachments: Attachment[], title?: string | null): PlannedFile[] {
  const hwpTwins = new Set<string>();
  for (const a of attachments) {
    const e = extOf(a.originalName);
    // 저장된 hwp만 쌍둥이로 친다: hwp가 저장 실패면 pdf가 유일한 사본이다.
    if ((e === 'hwp' || e === 'hwpx') && a.status === 'saved' && a.savedName) hwpTwins.add(`${a.origin ?? 'bid'}|${twinKey(a.originalName)}`);
  }
  return attachments.map((attachment) => {
    const name = attachment.originalName;
    const classified = classifyName(name, title);
    const skip = (skipReason: SkipReason): PlannedFile => ({ attachment, classified, action: 'skip', skipReason });
    if (!SUPPORTED_EXT.has(extOf(name))) return skip('unsupported_ext');
    if (classified.priority === 0) return skip('excluded');
    if (attachment.duplicateOf) return skip('duplicate');
    if (attachment.status !== 'saved' || !attachment.savedName) return skip('not_saved');
    if (extOf(name) === 'pdf' && hwpTwins.has(`${attachment.origin ?? 'bid'}|${twinKey(name)}`)) return skip('duplicate');
    return { attachment, classified, action: 'parse' };
  });
}
