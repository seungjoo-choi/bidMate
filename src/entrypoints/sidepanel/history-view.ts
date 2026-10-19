import { formatAmountShort, formatDifferential, formatJoint, formatPeriod, formatScore } from '../../core/model/format';
import type { BasicFacts, EvalFacts } from '../../core/model/notice-summary';
import type { CollectResult, Job, JobEvent, JobLog, LogStep } from '../../core/types/job';
import { handoffView } from '../../ui/handoff-view';
import { formatDateTime, formatDDay } from '../../ui/review/format';
import { clockText, secsText, sizeText } from './view-format';

/** 수집 기록 카드 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type LineTone = 'normal' | 'live' | 'good' | 'bad';
export interface HistoryLine {
  key: string; time: string; tone: LineTone;
  /** 파일 줄이면 파일명 */
  name?: string; size?: string; text: string;
  /** 받는 중 파일의 진행률(0~1) */
  ratio?: number;
  error?: { code?: string; message: string };
}
export interface FactRow { label: string; value: string; check?: boolean; dday?: string }
export interface HistoryStep {
  id: LogStep; name: string; state: NodeState; dur: string;
  /** 현재 회차에 기록이 없고 이전 회차에서 끝난 단계 */
  carried: boolean;
  lines: HistoryLine[]; facts: FactRow[];
}
export interface HistoryRun { attempt: number; label: string }
export interface HistoryView {
  runs: HistoryRun[];
  selected: number;
  steps: HistoryStep[];
  /** 진행 중 단계 id(아이콘 선택용). 없으면 null */
  runningId: LogStep | null;
  /** 접힌 헤더의 한 줄 요약 */
  summary: string;
  defaultOpen: boolean;
  /** 선택한 회차가 지금 진행 중인 회차 */
  live: boolean;
}
export interface HistoryInput {
  log: JobLog | null;
  job: Job | null;
  /** collect 잡의 handoff가 가리키는 compose 잡 */
  compose?: Job | null;
  /** 요약 카드가 그려지는지(없으면 기록을 펼쳐 둔다) */
  hasSummary: boolean;
  /** 보고 싶은 회차. 없으면 잡의 현재 회차 */
  attempt?: number;
}

const STEPS: Array<{ id: LogStep; name: string }> = [
  { id: 'fetch_html', name: '상세화면 읽기' },
  { id: 'fetch_basic', name: '공고정보 조회' },
  { id: 'download_attachments', name: '첨부파일 다운로드' },
  { id: 'extract', name: '평가정보 추출' },
  { id: 'handoff', name: '후속 처리' },
];
const ACTIVE = new Set<Job['status']>(['queued', 'running', 'cancelling']);
const FINISH_LABEL: Record<Job['status'], string> = {
  queued: '대기', running: '진행 중', cancelling: '취소 중', completed: '완료', partial: '일부 실패', failed: '실패', cancelled: '취소됨', interrupted: '중단됨',
};
const FILE_STATUS: Record<string, string> = {
  failed: '실패', size_mismatch: '크기 불일치', skipped: '건너뜀', unsupported: '추출 대상 아님',
};

function stepOf(e: JobEvent): LogStep | null {
  if (e.kind === 'step' || e.kind === 'file' || e.kind === 'note' || e.kind === 'facts') return e.step;
  if (e.kind === 'handoff') return 'handoff';
  return null;
}

const dd = (s: string | null) => (s === null || s === '' ? null : s);
function row(label: string, value: string | null | undefined, extra: Partial<FactRow> = {}): FactRow[] {
  return value && value !== '—' ? [{ label, value, ...extra }] : [];
}

function basicRows(f: BasicFacts, now: Date): FactRow[] {
  const dday = (iso: string | null) => formatDDay(iso, now) ?? undefined;
  if (f.prespec) {
    const p = f.prespec;
    return [
      ...row('발주기관', dd(f.orderingOrg)),
      ...row('의견등록마감', formatDateTime(p.opinionCloseAt), { dday: dday(p.opinionCloseAt) }),
      ...row('배정예산', formatAmountShort(p.assignedBudget)),
      ...row('사업구분', dd(p.bizDivision)),
    ];
  }
  return [
    ...row('발주기관', dd(f.orderingOrg)),
    ...row('추정가격', formatAmountShort(f.estimatedPrice)),
    ...row('계약방법', dd(f.contractMethod)),
    ...row('낙찰방법', dd(f.awardMethod)),
    ...row('공동도급', formatJoint(f.jointVentureAllowed)),
    ...row('입찰마감', formatDateTime(f.bidCloseAt), { dday: dday(f.bidCloseAt) }),
    ...row('개찰', formatDateTime(f.openingAt)),
  ];
}

function evalRows(f: EvalFacts): FactRow[] {
  const it = f.items;
  const r = (label: string, k: keyof EvalFacts['items'], fmt: (v: any) => string) =>
    row(label, fmt(it[k].value), it[k].needsCheck ? { check: true } : {});
  return [
    ...r('실적 점수', 'performanceScore', formatScore),
    ...r('경영상태', 'managementScore', formatScore),
    ...r('신인도', 'credibilityScore', formatScore),
    ...r('실적 기간', 'performancePeriod', formatPeriod),
    ...r('실적 최소금액', 'performanceMinAmount', formatAmountShort),
    ...r('차등점수', 'differentialScoring', formatDifferential),
  ];
}

function lastOf<T extends JobEvent>(evs: JobEvent[], pred: (e: JobEvent) => e is T): T | undefined {
  for (let i = evs.length - 1; i >= 0; i--) if (pred(evs[i]!)) return evs[i] as T;
  return undefined;
}
type StepEv = Extract<JobEvent, { kind: 'step' }>;
const isStep = (e: JobEvent): e is StepEv => e.kind === 'step';

/** 수집 잡의 기록(JobLog)과 잡 상태 -> 회차별 타임라인. */
export function historyView(input: HistoryInput, now: Date = new Date()): HistoryView {
  const { log, job, hasSummary } = input;
  const events = [...(log?.events ?? [])].sort((a, b) => a.seq - b.seq);
  const attempts = [...new Set(events.map((e) => e.attempt))].sort((a, b) => b - a);
  const selected = input.attempt ?? job?.attempt ?? attempts[0] ?? 1;
  const jobActive = !!job && ACTIVE.has(job.status);
  const live = !!job && jobActive && selected === job.attempt;

  const inAttempt = (n: number) => events.filter((e) => e.attempt === n);
  const stepEvents = (n: number, id: LogStep) => inAttempt(n).filter((e) => stepOf(e) === id);

  const runs: HistoryRun[] = attempts.map((n) => {
    const evs = inAttempt(n);
    const fin = lastOf(evs, (e): e is Extract<JobEvent, { kind: 'finish' }> => e.kind === 'finish');
    const t = clockText(evs[0]?.at).slice(0, 5);
    const suffix = fin && fin.status !== 'completed' ? `, ${FINISH_LABEL[fin.status]}` : '';
    return { attempt: n, label: `${t} 수집 (${n}회차${suffix})` };
  });

  const cur = inAttempt(selected);
  const finish = lastOf(cur, (e): e is Extract<JobEvent, { kind: 'finish' }> => e.kind === 'finish');

  const steps: HistoryStep[] = STEPS.map(({ id, name }) => {
    const evs = stepEvents(selected, id);
    const base = { id, name, lines: [] as HistoryLine[], facts: [] as FactRow[] };

    if (id === 'handoff') {
      const lines: HistoryLine[] = evs.filter((e) => e.kind === 'note').map((e) => ({
        key: `n${e.seq}`, time: clockText(e.at), tone: 'normal' as const, text: (e as Extract<JobEvent, { kind: 'note' }>).label,
      }));
      const hev = lastOf(evs, (e): e is Extract<JobEvent, { kind: 'handoff' }> => e.kind === 'handoff');
      if (!hev) return { ...base, lines, state: 'pending', dur: '', carried: false };
      const compose = selected === job?.attempt ? input.compose ?? null : null;
      const v = job ? handoffView({ ...job, handoff: hev.handoff }, compose) : null;
      const state: NodeState = !v ? 'skipped'
        : v.tone === 'error' ? 'failed'
          : v.kind === 'queued' || v.kind === 'composing' ? 'running'
            : v.kind === 'skipped' ? 'skipped' : 'done';
      lines.push({ key: `h${hev.seq}`, time: clockText(hev.at), tone: state === 'failed' ? 'bad' : 'normal', text: v?.text ?? '메일 작성 안 함' });
      return { ...base, lines, state, dur: state === 'running' ? '진행 중' : '', carried: false };
    }

    const lastStep = lastOf(evs, isStep);
    if (evs.length === 0) {
      const earlier = attempts.some((n) => n < selected && lastOf(stepEvents(n, id), isStep)?.status === 'done');
      return earlier
        ? { ...base, state: 'done', dur: '이전 회차에서 완료', carried: true }
        : { ...base, state: 'pending', dur: '', carried: false };
    }
    let state: NodeState = lastStep?.status ?? (live ? 'running' : 'pending');
    // 끝난 회차에서 진행 중으로 남은 단계는 중단된 것으로 본다.
    if (state === 'running' && finish) state = 'failed';
    const dur = state === 'running' ? '진행 중' : lastStep?.ms !== undefined && lastStep.status !== 'running' ? secsText(lastStep.ms) : '';

    const lines: HistoryLine[] = [];
    const files = new Map<string, HistoryLine>();
    const bytes = live ? job?.steps.find((s) => s.id === 'download_attachments')?.bytes : undefined;
    for (const e of evs) {
      if (e.kind === 'step') {
        const msg = e.error?.message;
        lines.push({
          key: `s${e.seq}`, time: clockText(e.at), tone: e.status === 'failed' ? 'bad' : 'normal',
          text: msg && msg === e.label ? '실패' : e.label,
          ...(e.error ? { error: { code: e.error.code, message: e.error.message } } : {}),
        });
      } else if (e.kind === 'note') {
        lines.push({ key: `n${e.seq}`, time: clockText(e.at), tone: 'normal', text: e.label });
      } else if (e.kind === 'file') {
        const k = e.file.id;
        const dl = id === 'download_attachments';
        let ln = files.get(k);
        if (!ln) {
          ln = { key: `f${e.seq}`, time: clockText(e.at), tone: 'normal', name: e.file.name, size: sizeText(e.file.size), text: '' };
          files.set(k, ln);
          lines.push(ln);
        }
        if (e.phase === 'start') {
          ln.tone = 'live';
          ln.text = dl ? '받는 중' : '평가정보 읽는 중';
          if (dl && bytes && bytes.total && (bytes.name === undefined || bytes.name === e.file.name)) ln.ratio = Math.min(1, bytes.received / bytes.total);
        } else {
          delete ln.ratio;
          const ok = e.status === 'saved' || e.status === 'parsed';
          const label = ok ? '' : e.status ? FILE_STATUS[e.status] ?? e.status : e.error ? '실패' : '';
          const parts = [label, e.ms !== undefined ? secsText(e.ms) : ''].filter(Boolean);
          ln.text = parts.join(', ');
          ln.tone = e.error || e.status === 'failed' || e.status === 'size_mismatch' ? 'bad' : ok ? 'good' : 'normal';
          if (e.error) ln.error = { message: e.error };
          if (!ln.size) ln.size = sizeText(e.file.size);
        }
      }
    }
    // 단계가 끝났는데 끝 기록이 없는 파일 줄(기록 절단 등)은 진행 중으로 두지 않는다.
    if (state !== 'running') for (const ln of lines) if (ln.tone === 'live' && ln.name) { ln.tone = 'normal'; ln.text = '결과 기록 없음'; }
    const last = lines[lines.length - 1];
    if (state === 'running' && last && last.tone === 'normal' && !last.name && lastStep?.status === 'running' && last.key === `s${lastStep.seq}`) last.tone = 'live';

    const fev = lastOf(evs, (e): e is Extract<JobEvent, { kind: 'facts' }> => e.kind === 'facts');
    const facts = fev ? ('items' in fev.facts ? evalRows(fev.facts) : basicRows(fev.facts, now)) : [];
    return { ...base, lines, facts, state, dur, carried: false };
  });

  const t0 = cur[0]?.at;
  let summary = '';
  if (finish) {
    const res = selected === job?.attempt ? (job?.result as Partial<CollectResult> | undefined) : undefined;
    const atts = res?.attachments;
    const secs = t0 && Number.isFinite(Date.parse(t0)) ? secsText(Date.parse(finish.at) - Date.parse(t0)) : '';
    summary = [FINISH_LABEL[finish.status], secs, atts ? `첨부 ${atts.filter((a) => a.status === 'saved').length}/${atts.length}` : ''].filter(Boolean).join(', ');
  } else if (live) {
    summary = '수집 중';
  }

  return {
    runs, selected, steps,
    runningId: steps.find((s) => s.state === 'running')?.id ?? null,
    summary,
    defaultOpen: !(job?.status === 'completed' && hasSummary),
    live,
  };
}
