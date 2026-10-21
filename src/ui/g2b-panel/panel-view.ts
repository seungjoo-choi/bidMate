import { refsConflict } from '../../core/model/job-conflict';
import type { CollectResult, Job, StepState } from '../../core/types/job';
import type { FixTarget, NoticeLookup } from '../../messaging/protocol';
import { formatDDay } from '../review/format';
import { handoffView, type HandoffView } from '../handoff-view';

/** 잡 → 패널 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type ErrorAction = 'grant' | 'settings' | 'retry' | 'none';
export interface FailedFile { name: string; reason: string }

export type PanelView =
  | { kind: 'idle'; buttonLabel: string; collected?: CollectedView }
  | {
      kind: 'progress'; title?: string; foreignLabel?: string; label: string; ratio: number; attach?: { done: number; total: number };
      errorCount: number; cancelling: boolean; pillText: string;
    }
  | { kind: 'completed'; headline: string; folder?: string; chip: CollectedView; title?: string; foreign: boolean; extractionLine?: string; reviewNoticeId?: string; handoff?: HandoffView;
      /** 완료 카드의 [상세]/[메일 작성] 대상. 대시보드는 저절로 열지 않는다 */
      noticeId?: string }
  | { kind: 'partial'; headline: string; failures: FailedFile[]; moreCount: number; folder?: string; title?: string; foreign: boolean; canRetry: boolean; retryLabel: string; extractionLine?: string; reviewNoticeId?: string; handoff?: HandoffView; noticeId?: string }
  | { kind: 'error'; message: string; detail?: string; action: ErrorAction; actionLabel?: string; fix?: FixTarget; title?: string; foreign: boolean; hint?: string; handoff?: HandoffView };

const pad = (n: number) => String(n).padStart(2, '0');

/** 수집된 공고의 상태 칩. dday는 마감일이 없으면 null */
export interface CollectedView { tone: 'ok' | 'warn'; text: string; dday: string | null }

export function collectedView(lookup: NoticeLookup, now: Date = new Date()): CollectedView | undefined {
  if (!lookup.found || !lookup.collectStatus) return undefined;
  const ok = lookup.collectStatus === 'collected';
  return { tone: ok ? 'ok' : 'warn', text: ok ? '수집 완료' : '일부 실패', dday: formatDDay(lookup.bidCloseAt, now) };
}

/**
 * 막대에서 step이 차지하는 무게(체감 소요 시간 기준). 없는 step은 1.
 * 상세화면 읽기는 오래 걸리고 첨부 다운로드는 금방 끝나서, 같은 몫이면 막대가 멈췄다가 훅 넘어간다.
 */
const STEP_WEIGHT: Partial<Record<string, number>> = { fetch_basic: 1, download_attachments: 1.5, fetch_html: 4, extract: 1.5 };
const weightOf = (s: StepState): number => STEP_WEIGHT[s.id] ?? 1;

/** 완료 step 무게 + 다운로드 step 내부 비율을 전체 무게로 나눈다. */
export function progressRatio(steps: StepState[]): number {
  if (steps.length === 0) return 0;
  let sum = 0;
  let total = 0;
  for (const s of steps) {
    const w = weightOf(s);
    total += w;
    if (s.status === 'done' || s.status === 'skipped' || s.status === 'failed') sum += w;
    else if (s.status === 'running' && s.id === 'download_attachments' && s.progress && s.progress.total > 0) {
      const cur = s.bytes && s.bytes.total ? Math.min(1, s.bytes.received / s.bytes.total) : 0;
      sum += w * Math.min(1, (s.progress.done + cur) / s.progress.total);
    }
  }
  return Math.max(0, Math.min(1, sum / total));
}

/** 진행 중 step이 막대에서 차지하는 몫(0~1). 진행 중 step이 없으면 undefined */
export function runningStepSpan(steps: StepState[]): number | undefined {
  const cur = steps.find((s) => s.status === 'running');
  if (!cur) return undefined;
  return weightOf(cur) / steps.reduce((t, s) => t + weightOf(s), 0);
}

export const COLLECT_STEP_LABEL: Record<string, string> = {
  fetch_basic: '공고정보 조회 중', download_attachments: '첨부파일 다운로드 중', fetch_html: '상세화면 읽는 중',
  extract: '평가정보 추출 중',
};

/** 추출 결과 한 줄. 추출이 실행되지 않았거나 지원 대상이 없으면 표시하지 않는다. */
function extractionLineOf(r: CollectResult | undefined): string | undefined {
  const x = r?.extraction;
  if (!x || x.status === 'not_run' || x.status === 'unsupported') return undefined;
  if (x.status === 'failed') return '평가정보 추출 실패';
  return x.reviewCount > 0 ? `평가정보: 확인 필요 ${x.reviewCount}건` : '평가정보 확인 완료';
}

type ErrBase = Omit<Extract<PanelView, { kind: 'error' }>, 'title' | 'foreign' | 'hint'>;
function errorView(code: string | undefined, message: string | undefined): ErrBase {
  switch (code) {
    case 'NEEDS_FS_PERMISSION':
      return { kind: 'error', message: '저장 폴더 접근을 다시 허용해야 합니다', action: 'grant', actionLabel: '폴더 접근 허용', fix: { page: 'settings', section: 'storage' } };
    case 'G2B_KEY_MISSING':
    case 'G2B_KEY_INVALID':
      return { kind: 'error', message: '나라장터 서비스키를 확인해 주세요', action: 'settings', actionLabel: '설정 열기', fix: { page: 'settings', section: 'g2b' } };
    case 'G2B_NOT_FOUND':
      return { kind: 'error', message: 'API에서 이 공고를 찾지 못했습니다', action: 'none' };
    default:
      return { kind: 'error', message: '수집 중 오류가 발생했습니다', detail: message, action: 'retry', actionLabel: '다시 시도' };
  }
}

export interface PanelViewOpts {
  /** 현재 화면 공고의 제목 */
  title?: string;
  /** 현재 화면의 공고. 잡의 공고와 다르면 잡 기준으로 표시하고 재시도를 숨긴다. */
  current?: { noticeNo: string; round?: string } | null;
  /** collect 잡의 handoff.jobId가 가리키는 compose 잡 */
  compose?: Job | null;
}

/** 잡 → 표시 상태. 제목/결과/재시도 대상은 잡 기준으로 정한다. */
export function panelView(job: Job | null, lookup: NoticeLookup, opts: PanelViewOpts = {}): PanelView {
  if (!job || job.status === 'cancelled') {
    const collected = collectedView(lookup);
    return lookup.found && lookup.collectedAt
      ? { kind: 'idle', buttonLabel: '다시 수집', ...(collected ? { collected } : {}) }
      : { kind: 'idle', buttonLabel: '공고 수집' };
  }
  const result = job.result as CollectResult | undefined;
  const foreign = !!job.ref && !!opts.current && !refsConflict(job.ref, opts.current);
  const jobTitle = result?.title ?? (foreign ? undefined : opts.title);
  const att = result?.attachments ?? [];
  const handoff = foreign ? undefined : handoffView(job, opts.compose ?? null) ?? undefined;
  const ho = handoff ? { handoff } : {};
  const noticeIdPart = result?.noticeId ? { noticeId: result.noticeId } : {};
  const saved = att.filter((a) => a.status === 'saved').length;

  switch (job.status) {
    case 'queued':
    case 'running':
    case 'cancelling': {
      const dl = job.steps.find((s) => s.id === 'download_attachments');
      const attach = dl?.progress ? { done: dl.progress.done, total: dl.progress.total } : undefined;
      const cur = job.currentStep;
      return {
        kind: 'progress', title: jobTitle ?? (foreign ? job.ref?.noticeNo : undefined),
        foreignLabel: foreign ? `다른 공고 수집 중: ${jobTitle ?? job.ref?.noticeNo}` : undefined,
        label: job.label ?? (cur ? COLLECT_STEP_LABEL[cur] ?? '수집 중' : '준비 중…'),
        ratio: progressRatio(job.steps), attach, errorCount: job.errors.length,
        cancelling: job.status === 'cancelling',
        pillText: attach ? `수집 중 ${attach.done}/${attach.total}` : '수집 중',
      };
    }
    case 'completed':
      return {
        kind: 'completed', headline: `수집 완료, 첨부 ${saved}/${att.length}`, folder: result?.folder, title: jobTitle, foreign,
        extractionLine: extractionLineOf(result), reviewNoticeId: extractionLineOf(result) ? result?.noticeId : undefined,
        chip: collectedView(lookup) ?? { tone: 'ok', text: '수집 완료', dday: null }, ...ho, ...noticeIdPart,
      };
    case 'partial': {
      const failed = att.filter((a) => a.status === 'failed' || a.status === 'size_mismatch');
      const extractFailed = job.errors.some((e) => e.code === 'EXTRACT_FAILED');
      const extractOnly = failed.length === 0 && extractFailed;
      return {
        kind: 'partial', headline: extractOnly ? `평가정보 추출 실패, 첨부 ${saved}/${att.length}` : `일부 첨부 실패, ${saved}/${att.length}`,
        extractionLine: extractFailed ? '평가정보 추출 실패' : extractionLineOf(result),
        reviewNoticeId: !extractFailed && extractionLineOf(result) ? result?.noticeId : undefined,
        retryLabel: extractOnly ? '평가정보 다시 추출' : extractFailed ? '실패 항목 재시도' : '실패 파일 재시도',
        failures: failed.slice(0, 5).map((a) => ({ name: a.name, reason: a.error ?? a.status })),
        moreCount: Math.max(0, failed.length - 5), folder: result?.folder, title: jobTitle, foreign, canRetry: !foreign, ...ho, ...noticeIdPart,
      };
    }
    case 'failed':
    case 'interrupted': {
      const e = job.errors[0];
      const base: ErrBase = !e && job.status === 'interrupted'
        ? { kind: 'error', message: '수집이 중단되었습니다', action: 'retry', actionLabel: '다시 시도' }
        : errorView(e?.code, e?.message);
      // 다른 공고의 잡에는 동작 버튼(재시도/폴더 허용)을 걸지 않는다.
      return foreign
        ? { ...base, action: 'none', actionLabel: undefined, title: jobTitle, foreign, hint: '해당 공고 화면에서 다시 시도하세요' }
        : { ...base, title: jobTitle, foreign, ...ho };
    }
  }
}
