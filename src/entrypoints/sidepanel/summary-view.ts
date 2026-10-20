import type { BasicFacts, EvalFacts } from '../../core/model/notice-summary';
import { formatAmountComma, formatAmountShort, formatDifferential, formatJoint, formatPeriod, formatScore } from '../../core/model/format';
import type { ExtractionKey } from '../../core/types/extraction';
import type { AiCardInfo } from '../../ui/review/ai-view';
import type { Job } from '../../core/types/job';
import type { Attachment, Notice, NoticeKind } from '../../core/types/notice';
import { formatDateTime, formatDDay } from '../../ui/review/format';
import { dash, sizeText } from './view-format';

/** 사이드 패널 요약 카드 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type ChipTone = 'ok' | 'run' | 'warn' | 'danger';
export interface StatusChip { tone: ChipTone; text: string }
export interface KeyCell { label: string; value: string; sub: string; hot?: boolean }
/** ai: 검증을 통과한 AI 제안이 있는 행(제안 배지). 일치·못 찾음은 표시하지 않는다. */
export interface SummaryRow { label: string; value: string; check?: boolean; ai?: true }
export type ExtBadge = 'pdf' | 'hwp' | 'zip' | 'xls' | 'etc';
export interface SummaryFile { name: string; ext: ExtBadge; extLabel: string; size: string; problem?: string }

export interface SummaryInput {
  facts: BasicFacts;
  eval: EvalFacts;
  notice: Pick<Notice, 'id' | 'folder' | 'attachments' | 'collect'>;
  /** buildAiCards 결과. 없으면 배지 없음 */
  ai?: Partial<Record<ExtractionKey, Pick<AiCardInfo, 'suggestion'>>>;
  /** 검수 버튼 배지. 공고 상세 검토 탭과 같은 13행 기준(noticeReviewCount). 없으면 문서 항목 수 */
  reviewCount?: number;
}
export interface SummaryView {
  kind: NoticeKind;
  kindLabel: string;
  title: string;
  noticeNo: string;
  status: StatusChip;
  key3: KeyCell[];
  basic: SummaryRow[];
  /** 사전규격이거나 추출 미실행이면 null */
  evaluation: { reviewCount: number; rows: SummaryRow[] } | null;
  attachments: { title: string; files: SummaryFile[] };
  actions: { noticeId: string; folder: string; reviewCount: number };
}

const ACTIVE = new Set<Job['status']>(['queued', 'running', 'cancelling']);

/** 상단 카드 상태 칩. 진행 중 잡이 있으면 수집 중, 아니면 잡 결과, 잡이 없으면 저장된 수집 결과 기준. */
export function statusChip(job: Job | null, collect: Pick<Notice['collect'], 'status' | 'collectedAt'> | null): StatusChip | null {
  if (job && ACTIVE.has(job.status)) return { tone: 'run', text: '수집 중' };
  const at = collect ? formatDateTime(collect.collectedAt) : '';
  const stamp = (text: string) => ({ text: at && at !== '—' ? `${text}, ${at}` : text });
  if (job?.status === 'failed' || job?.status === 'interrupted') return { tone: 'danger', text: '실패' };
  if (job?.status === 'partial') return { tone: 'warn', ...stamp('일부 실패') };
  if (job?.status === 'completed') return { tone: 'ok', ...stamp('수집 완료') };
  if (!collect) return null;
  if (collect.status === 'collected') return { tone: 'ok', ...stamp('수집 완료') };
  if (collect.status === 'partial') return { tone: 'warn', ...stamp('일부 실패') };
  return { tone: 'danger', text: '실패' };
}

export function extOf(name: string): { ext: ExtBadge; label: string } {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  const e = m ? m[1]!.toLowerCase() : '';
  if (e === 'pdf') return { ext: 'pdf', label: 'PDF' };
  if (e === 'hwp' || e === 'hwpx') return { ext: 'hwp', label: 'HWP' };
  if (e === 'zip' || e === '7z' || e === 'rar') return { ext: 'zip', label: 'ZIP' };
  if (e === 'xls' || e === 'xlsx' || e === 'xlsm' || e === 'csv') return { ext: 'xls', label: 'XLS' };
  return { ext: 'etc', label: e ? e.slice(0, 4).toUpperCase() : '파일' };
}

const PROBLEM: Partial<Record<Attachment['status'], string>> = {
  failed: '실패', size_mismatch: '크기 불일치', pending: '대기', downloading: '받는 중', skipped: '건너뜀',
};

export function summaryView(input: SummaryInput, now: Date = new Date()): SummaryView {
  const { facts: f, eval: ev, notice, ai } = input;
  const prespec = f.kind === 'prespec' && !!f.prespec;
  const key3: KeyCell[] = prespec
    ? [
      { label: '의견등록마감', value: dash(formatDDay(f.prespec!.opinionCloseAt, now)), sub: dash(formatDateTime(f.prespec!.opinionCloseAt)), hot: true },
      { label: '배정예산', value: dash(formatAmountShort(f.prespec!.assignedBudget)), sub: f.prespec!.assignedBudget === null ? '' : dash(formatAmountComma(f.prespec!.assignedBudget)) },
      { label: '사업구분', value: dash(f.prespec!.bizDivision), sub: '' },
    ]
    : [
      { label: '입찰마감', value: dash(formatDDay(f.bidCloseAt, now)), sub: dash(formatDateTime(f.bidCloseAt)), hot: true },
      { label: '추정가격', value: dash(formatAmountShort(f.estimatedPrice)), sub: f.estimatedPrice === null ? '' : dash(formatAmountComma(f.estimatedPrice)) },
      { label: '낙찰방법', value: dash(f.awardMethod), sub: f.contractMethod ?? '' },
    ];
  const basic: SummaryRow[] = [
    { label: '발주기관', value: dash(f.orderingOrg) },
    { label: '수요기관', value: dash(f.demandOrg) },
    { label: '공동도급', value: dash(formatJoint(f.jointVentureAllowed)) },
    { label: '참가자격', value: dash(f.eligibility) },
    { label: '사업기간', value: dash(f.projectPeriod) },
    { label: '개찰', value: dash(formatDateTime(f.openingAt)) },
  ];
  const evaluation = f.kind === 'prespec' || ev.extractionStatus === 'not_run'
    ? null
    : {
      reviewCount: ev.reviewCount,
      rows: ([
        ['실적', 'performanceScore', formatScore],
        ['경영상태', 'managementScore', formatScore],
        ['신인도', 'credibilityScore', formatScore],
        ['실적 기간', 'performancePeriod', formatPeriod],
        ['실적 최소금액', 'performanceMinAmount', formatAmountShort],
        ['차등점수', 'differentialScoring', formatDifferential],
      ] as const).map(([label, key, fmt]): SummaryRow => {
        const verdict = ai?.[key]?.suggestion.verdict;
        return {
          label, value: ev.items[key].notApplicable ? '해당 없음' : dash((fmt as (v: unknown) => string)(ev.items[key].value)), check: ev.items[key].needsCheck,
          ...(verdict === 'new' || verdict === 'differs' ? { ai: true as const } : {}),
        };
      }),
    };
  const atts = notice.attachments;
  const saved = atts.filter((a) => a.status === 'saved').length;
  const files = atts.map((a): SummaryFile => {
    const { ext, label } = extOf(a.originalName);
    const problem = PROBLEM[a.status];
    return { name: a.originalName, ext, extLabel: label, size: sizeText(a.savedSize ?? a.expectedSize), ...(problem ? { problem } : {}) };
  });
  return {
    kind: f.kind,
    kindLabel: f.kind === 'prespec' ? '사전규격' : f.kind === 'orderplan' ? '발주계획' : '입찰공고',
    title: f.title ?? f.noticeNo,
    noticeNo: f.round ? `${f.noticeNo}-${f.round}` : f.noticeNo,
    status: statusChip(null, notice.collect) ?? { tone: 'ok', text: '수집 완료' },
    key3, basic, evaluation,
    attachments: { title: `첨부 ${saved}/${atts.length}`, files },
    actions: { noticeId: notice.id, folder: notice.folder, reviewCount: input.reviewCount ?? ev.reviewCount },
  };
}
