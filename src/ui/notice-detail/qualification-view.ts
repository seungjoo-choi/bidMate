/** 공고 상세 참가 자격(실적) 카드 표시 모델(순수 함수). React/chrome/entrypoints를 import하지 않는다. */
import type { Criteria, Criterion, Judgement, Verdict } from '../../core/qualification/judge';
import { formatAmountShort } from '../review/format';
import type { BadgeStatus } from '../components/StatusBadge';

export interface QualificationMatchedRow { title: string; client: string; compareAmount: string; endAt: string }
export interface QualificationLineView { title: string; reasons: string[]; matched: QualificationMatchedRow[]; more: number }
export interface QualificationView {
  badge: { text: string; status: BadgeStatus };
  headline: string;
  lines: QualificationLineView[];
  footnotes: string[];
  /** 인정조건 원문(길면 잘라 truncated=true). 없으면 null. */
  condition: { text: string; truncated: boolean } | null;
  settingsHref: string;
}

const MAX_MATCHED = 5;
const MAX_CONDITION = 200;

const BADGE: Record<Verdict, { text: string; status: BadgeStatus }> = {
  met: { text: '충족', status: 'ok' },
  possibly_short: { text: '미달 가능', status: 'warn' },
  review: { text: '확인 필요', status: 'warn' },
  no_data: { text: '실적 없음', status: 'idle' },
};
const HEADLINE: Record<Verdict, string> = {
  met: '인정기간과 인정금액을 충족하는 실적이 있습니다',
  possibly_short: '조건에 맞는 실적을 찾지 못했습니다. 실적 목록과 추출값을 확인하세요',
  review: '자동으로 판정할 수 없는 항목이 있습니다',
  no_data: '실적 목록이 비어 있습니다',
};

const periodText = (c: Criterion<number> | null): string => (c && c.value !== null ? `${c.value}년` : '없음');
const amountText = (c: Criterion<number> | null): string => (c && c.value !== null ? formatAmountShort(c.value) : '없음');

export function qualificationView(j: Judgement, _criteria: Criteria): QualificationView {
  const multi = j.lines.length > 1;
  const lines = j.lines.map((l, i): QualificationLineView => ({
    title: multi ? `후보 ${i + 1}: 인정기간 ${periodText(l.period)}, 인정금액 ${amountText(l.amount)}` : '',
    reasons: l.reasons,
    matched: l.matched.slice(0, MAX_MATCHED).map((m) => ({
      title: m.p.title, client: m.p.client, compareAmount: formatAmountShort(m.compareAmount), endAt: m.p.endAt ?? '',
    })),
    more: Math.max(0, l.matched.length - MAX_MATCHED),
  }));
  const footnotes: string[] = [];
  if (j.inProgress > 0) footnotes.push(`진행 중 실적 ${j.inProgress}건은 판정에서 제외했습니다`);
  const condition = j.conditionText
    ? { text: j.conditionText.slice(0, MAX_CONDITION), truncated: j.conditionText.length > MAX_CONDITION }
    : null;
  return { badge: BADGE[j.verdict], headline: HEADLINE[j.verdict], lines, footnotes, condition, settingsHref: '#/settings?section=performances' };
}
