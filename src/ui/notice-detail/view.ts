/** 공고 상세 화면 표시 모델(순수 함수). React/chrome/entrypoints를 import하지 않는다. */
import { kindOf } from '../../core/model/ids';
import { normalizePath } from '../../core/model/path';
import type { FieldValue } from '../../core/types/common';
import type { Extraction } from '../../core/types/extraction';
import type { IndexEntry } from '../../core/types/index-file';
import type { Job, JobStatus, JobType, StepId } from '../../core/types/job';
import type { MailDraft } from '../../core/types/mail';
import type { AttachmentStatus, CollectStatus, MailStatus, Notice } from '../../core/types/notice';
import type { NoticeTab } from '../../entrypoints/dashboard/route';
import type { BadgeStatus } from '../components/StatusBadge';
import { formatAmountComma } from '../../core/model/format';
import { dDayLevel, formatAmountFull, formatAmountShort, formatDDay, formatDateTime, formatDifferential, formatPeriod, formatScore } from '../review/format';
import { DOC_KIND_LABEL, summarize } from '../review/view';

export interface DetailRow { label: string; value: string; mark?: 'needs_review' | 'user_edited'; href?: string; pre?: boolean; hint?: string }
export interface DetailGroup { id: string; title: string; description?: string; rows: DetailRow[] }

const EMPTY = '—';

function markOf(f: FieldValue<unknown>): DetailRow['mark'] {
  return f.status === 'needs_review' ? 'needs_review' : f.status === 'user_edited' ? 'user_edited' : undefined;
}

function row<T>(label: string, f: FieldValue<T>, fmt: (v: T) => string = (v) => String(v), extra: Partial<DetailRow> = {}): DetailRow {
  const r: DetailRow = { label, value: f.value === null || f.value === undefined || f.value === '' ? EMPTY : fmt(f.value), ...extra };
  const mark = markOf(f);
  if (mark) r.mark = mark;
  // 값이 비었어도 추출 설명(note)이나 원문(raw)이 있으면 보여준다. 예: 가감점 표만 있음
  if (r.value === EMPTY && (f.note || f.raw)) {
    r.value = f.note ?? f.raw!;
    if (f.note && f.raw) r.hint = f.raw;
  }
  return r;
}

const text = (v: string) => v;
const joint = (v: boolean) => (v ? '허용' : '불허');
const noticeHref = (id: string) => `#/notices/${encodeURIComponent(id)}`;

/** 확인이 필요한 평가 행은 검토 탭으로 연결한다(값이 없을 때만, 값 자체를 덮지 않도록). */
function withReviewLink(id: string, rows: DetailRow[]): DetailRow[] {
  return rows.map((r) => (r.mark === 'needs_review' && !r.href && r.hint !== undefined ? { ...r, href: `${noticeHref(id)}/review` } : r));
}

export function overviewGroups(n: Notice, index: IndexEntry[]): DetailGroup[] {
  const b = n.basic;
  if (kindOf(n.ref) === 'prespec') {
    const p = n.prespec;
    const related = p.relatedBidNo.value;
    const hit = related
      ? index.filter((e) => kindOf(e) === 'bid' && e.noticeNo === related).sort((a, c) => a.round.localeCompare(c.round)).pop()
      : undefined;
    return [{
      id: 'prespec', title: '사전규격 정보', rows: [
        row('사전규격 등록번호', p.specRegNo, text),
        row('사전규격명', p.specName, text),
        row('업무구분', p.bizDivision, text),
        row('배정예산', p.assignedBudget, formatAmountFull),
        row('공개일시', p.registeredAt, formatDateTime),
        row('의견등록 마감일시', p.opinionCloseAt, formatDateTime),
        row('담당자', p.officerName, text),
        row('담당자 연락처', p.officerTel, text),
        row('연계 입찰공고번호', p.relatedBidNo, text, hit ? { href: noticeHref(hit.noticeId) } : {}),
        row('발주기관', b.orderingOrg, text),
        row('수요기관', b.demandOrg, text),
      ],
    }];
  }
  const s = n.schedule;
  const e = n.evaluation;
  const groups: DetailGroup[] = [
    {
      id: 'overview', title: '공고 개요', rows: [
        { label: '공고번호', value: b.noticeNo.value ?? n.ref.noticeNo, ...(markOf(b.noticeNo) ? { mark: markOf(b.noticeNo) } : {}) },
        row('차수', b.round, text),
        row('공고일시', b.postedAt, formatDateTime),
        row('공고종류', b.noticeType, text),
        row('발주기관', b.orderingOrg, text),
        row('수요기관', b.demandOrg, text),
        { label: '정정공고 여부', value: n.isCorrection ? '정정공고' : '아니오' },
      ],
    },
    {
      id: 'money', title: '계약과 참가자격', rows: [
        row('사업예산', b.budgetAmount, formatAmountFull),
        row('추정가격', b.estimatedPrice, formatAmountFull),
        row('사업기간', b.projectPeriod, text),
        row('계약방법', b.contractMethod, text),
        row('낙찰자 결정방법', b.awardMethod, text),
        row('가격 결정방식', b.priceMethod, text),
        row('공동수급', b.jointVentureAllowed, joint),
        row('참가자격', b.eligibility, text, { pre: true }),
      ],
    },
    {
      id: 'schedule', title: '일정', rows: [
        row('참가등록 마감', s.registrationDeadline, formatDateTime),
        row('입찰 개시', s.bidStartAt, formatDateTime),
        row('입찰 마감', s.bidCloseAt, formatDateTime),
        row('제안서 제출기간', s.proposalPeriod, text),
        row('제안서 평가', s.proposalEvalAt, formatDateTime),
        row('개찰', s.openingAt, formatDateTime),
      ],
    },
    {
      id: 'evaluation', title: '평가 기준(공고정보 기준)',
      description: '공고정보에서 읽은 값입니다. 문서에서 추출한 값의 확인과 수정은 평가정보 검토 탭에서 합니다.',
      rows: withReviewLink(n.id, [
        row('평가방식', e.evalMethod, text),
        row('차등점수제', e.differentialScoring, formatDifferential),
        row('대외신인도 배점', e.credibilityScore, formatScore),
        row('경영상태 배점', e.managementScore, formatScore),
        row('수행실적 배점', e.performanceScore, formatScore),
        row('실적 인정기간', e.performancePeriod, formatPeriod),
        row('실적 인정금액', e.performanceMinAmount, formatAmountFull),
        row('실적 인정조건', e.performanceCondition, text),
      ]),
    },
  ];
  const custom = Object.entries(n.customFields ?? {});
  if (custom.length > 0) groups.push({ id: 'custom', title: '기타 항목', rows: custom.map(([k, f]) => row(k, f, text)) });
  return groups;
}

export const ATTACHMENT_STATUS: Record<AttachmentStatus, { label: string; tone: BadgeStatus }> = {
  pending: { label: '대기', tone: 'warn' },
  downloading: { label: '받는 중', tone: 'warn' },
  saved: { label: '저장됨', tone: 'ok' },
  failed: { label: '실패', tone: 'error' },
  skipped: { label: '건너뜀', tone: 'idle' },
  size_mismatch: { label: '크기 불일치', tone: 'error' },
};

export const VIEWABLE_EXT: ReadonlySet<string> = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt']);

export interface AttachmentRow {
  id: string; no: number; name: string; savedName: string | null; kind: string; size: string;
  status: AttachmentStatus; attempts: number; remark: string; openable: boolean;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMPTY;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

export function attachmentRows(n: Notice): AttachmentRow[] {
  return n.attachments.map((a) => {
    const name = a.originalName;
    const ext = extOf(a.savedName ?? name);
    const size = a.status === 'size_mismatch'
      ? `저장 ${formatBytes(a.savedSize)} / 예상 ${formatBytes(a.expectedSize)}`
      : formatBytes(a.savedSize ?? a.expectedSize);
    return {
      id: a.id, no: a.index + 1, name,
      savedName: a.savedName && a.savedName !== name ? a.savedName : null,
      kind: a.docKind ? DOC_KIND_LABEL[a.docKind] ?? a.docKind : ext.toUpperCase() || EMPTY,
      size, status: a.status, attempts: a.attempts, remark: a.lastError ?? a.note ?? '',
      openable: (a.status === 'saved' || a.status === 'size_mismatch') && !!a.savedName && VIEWABLE_EXT.has(extOf(a.savedName)),
    };
  });
}

export function attachmentSummary(n: Notice): { total: number; saved: number; failed: number; skipped: number } {
  const c = (f: (s: AttachmentStatus) => boolean) => n.attachments.filter((a) => f(a.status)).length;
  return {
    total: n.attachments.length,
    saved: c((s) => s === 'saved'),
    failed: c((s) => s === 'failed' || s === 'size_mismatch'),
    skipped: c((s) => s === 'skipped'),
  };
}

/** 폴더 상대 경로(`notices/...`). 복사 버튼과 첨부 폴더 표시에 쓴다. */
export function folderRelPath(folder: string): string {
  const f = folder.replace(/\\/g, '/');
  return f.startsWith('notices/') ? f : `notices/${f.replace(/^\/+/, '')}`;
}

/** 저장 폴더 루트 기준 세그먼트. savedName에 경로 구분자나 `..`가 있으면 throw. */
export function attachmentPath(folder: string, savedName: string): string[] {
  if (!savedName || savedName.includes('/') || savedName.includes('\\') || savedName.includes('..')) {
    throw new Error(`잘못된 파일 이름: ${savedName}`);
  }
  return [...normalizePath(folderRelPath(folder)).split('/'), 'attachments', savedName];
}

export interface RelatedNotice { noticeId: string; round: string; title: string; collectedAt: string; current: boolean }

export function relatedNotices(n: Notice, index: IndexEntry[]): { rounds: RelatedNotice[]; supersededBy?: string } {
  const kind = kindOf(n.ref);
  const no = n.basic.noticeNo.value || n.ref.noticeNo;
  const rounds = index
    .filter((e) => kindOf(e) === kind && e.noticeNo === no)
    .sort((a, b) => a.round.localeCompare(b.round))
    .map((e) => ({ noticeId: e.noticeId, round: e.round, title: e.title, collectedAt: e.collectedAt, current: e.noticeId === n.id }));
  const self = index.find((e) => e.noticeId === n.id);
  return self?.supersededBy ? { rounds, supersededBy: self.supersededBy } : { rounds };
}

export const COLLECT_BADGE: Record<CollectStatus, { tone: BadgeStatus; text: string }> = {
  collected: { tone: 'ok', text: '수집 완료' },
  partial: { tone: 'warn', text: '일부 누락' },
  failed: { tone: 'error', text: '수집 실패' },
};

export const MAIL_STATUS: Record<MailStatus, { label: string; tone: BadgeStatus }> = {
  none: { label: '초안 없음', tone: 'idle' },
  drafting: { label: '초안 작성됨', tone: 'warn' },
  ready_for_review: { label: '검토 대기', tone: 'warn' },
  delivered: { label: '발송 완료', tone: 'ok' },
};

export interface MailSummary {
  status: MailStatus; lastComposedAt: string | null; deliveredAt: string | null;
  draft: { preparedAt: string; subject: string; to: number; cc: number; attachments: number; skipped: number; editedAt: string | null } | null;
}

export function mailSummary(n: Notice, draft: MailDraft | null): MailSummary {
  return {
    status: n.mail.status,
    lastComposedAt: n.mail.lastComposedAt ?? null,
    deliveredAt: n.mail.deliveredAt ?? null,
    draft: draft ? {
      preparedAt: draft.preparedAt, subject: draft.subject, to: draft.to.length, cc: draft.cc.length,
      attachments: draft.attachments.length,
      skipped: draft.skippedAttachments.length + (draft.excludedAttachments?.length ?? 0),
      editedAt: draft.edited?.at ?? null,
    } : null,
  };
}

export const STEP_LABEL: Record<StepId, string> = {
  fetch_basic: '공고정보 조회', fetch_html: '상세화면 읽기', download_attachments: '첨부파일 다운로드',
  extract: '평가정보 추출', render_mail: '메일 본문 생성', open_compose: '메일 창 열기',
  fill_fields: '항목 입력', attach_files: '첨부', verify: '확인',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: '대기', running: '진행 중', cancelling: '취소 중', completed: '완료', partial: '일부 실패',
  failed: '실패', cancelled: '취소됨', interrupted: '중단됨',
};

const JOB_TYPE_LABEL: Record<JobType, string> = {
  collect: '수집', extract: '평가정보 추출', compose: '메일 작성', download_retry: '첨부 재시도',
};

const HANDOFF_LABEL: Record<NonNullable<Job['handoff']>['action'], string> = {
  compose: '자동 작성', review: '검수 이동', edit: '편집 이동', ask: '선택 대기', none: '생략',
};

export interface SessionJobRow { id: string; type: string; status: string; startedAt: string; endedAt: string; errorCount: number; firstError: string; handoff: string }

export function sessionJobRows(jobs: Job[], noticeId: string): SessionJobRow[] {
  return jobs
    .filter((j) => j.noticeId === noticeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((j) => {
      const done = ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(j.status);
      return {
        id: j.id, type: JOB_TYPE_LABEL[j.type] ?? j.type, status: JOB_STATUS_LABEL[j.status] ?? j.status,
        startedAt: formatDateTime(j.createdAt), endedAt: done ? formatDateTime(j.updatedAt) : EMPTY,
        errorCount: j.errors.length, firstError: j.errors[0]?.message ?? '',
        handoff: j.handoff ? HANDOFF_LABEL[j.handoff.action] : '',
      };
    });
}

export function detailTabs(n: Notice, extraction: Extraction | null): Array<{ id: NoticeTab; label: string; count?: number }> {
  const tabs: Array<{ id: NoticeTab; label: string; count?: number }> = [
    { id: 'overview', label: '개요' },
    { id: 'files', label: '첨부파일', count: n.attachments.filter((a) => a.status === 'saved').length },
    { id: 'history', label: '수집과 메일 이력' },
  ];
  if (kindOf(n.ref) !== 'prespec') {
    tabs.push(extraction
      ? { id: 'review', label: '평가정보 검토', count: summarize(extraction).needsReview }
      : { id: 'review', label: '평가정보 검토' });
  }
  return tabs;
}

export function effectiveTab(tab: NoticeTab, n: Notice): NoticeTab {
  return tab === 'review' && kindOf(n.ref) === 'prespec' ? 'overview' : tab;
}

/** 개요 상단 요약 띠의 칸 하나. tone은 값 글자색 등급. */
export interface StatItem { label: string; value: string; sub?: string; tone?: 'danger' | 'warn' | 'muted' }

function ddayStat(label: string, iso: string | null | undefined, now: Date): StatItem {
  const dday = formatDDay(iso, now);
  if (!dday) return { label, value: EMPTY };
  const level = dDayLevel(dday);
  return {
    label, value: dday === '마감' ? '마감됨' : dday, sub: formatDateTime(iso),
    ...(dday === '마감' ? { tone: 'muted' as const } : level === 'urgent' ? { tone: 'danger' as const } : level === 'soon' ? { tone: 'warn' as const } : {}),
  };
}

function amountStat(label: string, n: number | null | undefined): StatItem {
  return n === null || n === undefined ? { label, value: EMPTY } : { label, value: formatAmountShort(n), sub: formatAmountComma(n) };
}

export function overviewStats(n: Notice, now: Date = new Date()): StatItem[] {
  if (kindOf(n.ref) === 'prespec') {
    const p = n.prespec;
    return [
      amountStat('배정예산', p.assignedBudget.value),
      ddayStat('의견등록 마감', p.opinionCloseAt.value, now),
      { label: '공개일시', value: p.registeredAt.value ? formatDateTime(p.registeredAt.value) : EMPTY },
      { label: '업무구분', value: p.bizDivision.value || EMPTY },
    ];
  }
  const s = n.schedule;
  const evalAt = s.proposalEvalAt.value;
  return [
    amountStat('사업예산', n.basic.budgetAmount.value),
    amountStat('추정가격', n.basic.estimatedPrice.value),
    ddayStat('입찰 마감', s.bidCloseAt.value, now),
    { label: '개찰', value: s.openingAt.value ? formatDateTime(s.openingAt.value) : EMPTY, ...(evalAt ? { sub: `제안서 평가 ${formatDateTime(evalAt)}` } : {}) },
  ];
}

/** 일정 타임라인의 한 지점. done=지남, next=다음에 올 지점(하나), upcoming=그 뒤 */
export interface Milestone { key: string; label: string; when: string; dday: string | null; state: 'done' | 'next' | 'upcoming'; mark?: DetailRow['mark'] }

export function scheduleTimeline(n: Notice, now: Date = new Date()): Milestone[] {
  const s = n.schedule;
  const points: Array<[string, string, FieldValue<string>]> = [
    ['bidStartAt', '입찰 개시', s.bidStartAt],
    ['registrationDeadline', '참가등록 마감', s.registrationDeadline],
    ['bidCloseAt', '입찰 마감', s.bidCloseAt],
    ['openingAt', '개찰', s.openingAt],
    ['proposalEvalAt', '제안서 평가', s.proposalEvalAt],
  ];
  const dated = points
    .map(([key, label, f]) => ({ key, label, f, t: f.value ? new Date(f.value).getTime() : NaN }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  let nextSeen = false;
  return dated.map((p) => {
    const past = p.t < now.getTime();
    const state: Milestone['state'] = past ? 'done' : nextSeen ? 'upcoming' : 'next';
    if (!past) nextSeen = true;
    const m: Milestone = { key: p.key, label: p.label, when: formatDateTime(p.f.value), dday: past ? null : formatDDay(p.f.value, now), state };
    const mark = markOf(p.f);
    if (mark) m.mark = mark;
    return m;
  });
}
