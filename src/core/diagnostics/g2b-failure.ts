import type { ISODate } from '../types/common';
import type { CollectResult, Job } from '../types/job';

export const G2B_FAILURES_KEY = 'g2bFailures';
export const G2B_FAILURES_MAX = 300;
export const G2B_FAILURES_MAX_AGE_MS = 30 * 86_400_000;
export const G2B_FLOWS = ['eval', 'result', 'collect', 'detail', 'attachment', 'key-test'] as const;
export type G2bFlow = (typeof G2B_FLOWS)[number];
export const G2B_FLOW_LABEL: Record<G2bFlow, string> = { eval: '평가점수 가져오기', result: '낙찰 결과 조회', collect: '공고정보 조회', detail: '상세화면 읽기', attachment: '첨부파일 다운로드', 'key-test': '서비스키 테스트' };
export const G2B_TAB_PATHS = ['own', 'reused', 'reused-reloaded', 'created', 'created-fallback'] as const;
export type G2bTabPath = (typeof G2B_TAB_PATHS)[number];
export const G2B_TAB_LABEL: Record<G2bTabPath, string> = { own: '요청한 탭', reused: '열린 탭', 'reused-reloaded': '열린 탭(새로고침)', created: '새 탭', 'created-fallback': '새 탭(기존 탭 복구 실패)' };

export interface G2bFailureInput {
  flow: G2bFlow;
  stage: string;        // eval: 'tab'|'fetch'|'save'|'official' / result: 'opening'|'award'|'run'|'probe' / collect: 'fetch_basic'|'prespec' / detail: 'read' / attachment: 'download' / key-test: 'bid'|'prespec'
  code: string; message: string;
  noticeNo?: string; round?: string; noticeId?: string; jobId?: string;
  step?: number;        // eval 1~6
  httpStatus?: number; endpoint?: string; g2bMsg?: string;
  tab?: G2bTabPath; ms?: number;
  trigger?: string;     // 'dashboard'|'panel'|'probe'|'probe-noid'|'list'|'follow'|'manual'|'alarm'|'eval-save' 등
}
export interface G2bFailure extends G2bFailureInput { id: string; at: ISODate; lastAt: ISODate; count: number }
export interface G2bFailureFile { v: 1; items: G2bFailure[] }   // 최신 먼저

/** 기록하지 않는 코드: 사용자 취소·잘못된 참조·권한 등 연동 실패가 아닌 것. */
export const SKIP_CODES: ReadonlySet<string> = new Set([
  'EVAL_NO_RESULT', 'EVAL_NO_SYSTEM', 'EVAL_CANCELLED', 'JOB_CANCELLED', 'DETAIL_CANCELLED',
  'EVAL_BAD_REF', 'RESULT_BAD_REF', 'SENDER_FORBIDDEN', 'NEEDS_FS_PERMISSION',
]);

const LIMITS = { stage: 40, code: 60, message: 300, endpoint: 120, g2bMsg: 200, noticeNo: 20, round: 5, noticeId: 40, jobId: 60, trigger: 20 } as const;

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** 신뢰할 수 없는 입력(버스 detail·offscreen 페이로드)을 화이트리스트로만 읽어 레코드 입력으로 정규화한다. */
export function normalizeFailure(raw: unknown, redact: (s: string) => string): G2bFailureInput | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.flow !== 'string' || !(G2B_FLOWS as readonly string[]).includes(r.flow)) return null;
  if (typeof r.code !== 'string' || typeof r.stage !== 'string' || typeof r.message !== 'string') return null;
  if (SKIP_CODES.has(r.code)) return null;
  const out: G2bFailureInput = {
    flow: r.flow as G2bFlow,
    stage: cut(r.stage, LIMITS.stage),
    code: cut(r.code, LIMITS.code),
    message: cut(redact(r.message), LIMITS.message),
  };
  for (const k of ['noticeNo', 'round', 'noticeId', 'jobId', 'trigger'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v) out[k] = cut(v, LIMITS[k]);
  }
  for (const k of ['endpoint', 'g2bMsg'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v) out[k] = cut(redact(v), LIMITS[k]);
  }
  const int = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  const step = int(r.step, 1, 9);
  if (step !== undefined) out.step = step;
  const httpStatus = int(r.httpStatus, 100, 599);
  if (httpStatus !== undefined) out.httpStatus = httpStatus;
  const ms = int(r.ms, 0, Number.MAX_SAFE_INTEGER);
  if (ms !== undefined) out.ms = ms;
  if (typeof r.tab === 'string' && (G2B_TAB_PATHS as readonly string[]).includes(r.tab)) out.tab = r.tab as G2bTabPath;
  return out;
}

/** 실패 기록 파일에 입력을 반영한다. 최신과 같은 실패면 합산, 아니면 앞에 추가. 오래된 것·초과분 정리. */
export function appendFailures(file: G2bFailureFile | undefined, inputs: G2bFailureInput[], now: Date, newId: () => string): G2bFailureFile {
  const valid = !!file && file.v === 1 && Array.isArray(file.items);
  let items: G2bFailure[] = valid ? [...file.items] : [];
  const iso = now.toISOString();
  for (const input of inputs) {
    const top = items[0];
    if (top && top.flow === input.flow && top.stage === input.stage && top.code === input.code
      && top.noticeNo === input.noticeNo && top.round === input.round && top.message === input.message) {
      items[0] = { ...top, count: top.count + 1, lastAt: iso };
    } else {
      items = [{ ...input, id: newId(), at: iso, lastAt: iso, count: 1 }, ...items];
    }
  }
  const cutoff = now.getTime() - G2B_FAILURES_MAX_AGE_MS;
  items = items.filter((f) => new Date(f.lastAt).getTime() >= cutoff).slice(0, G2B_FAILURES_MAX);
  return { v: 1, items };
}

/** collect·download_retry 잡 스냅샷에서 연동 실패를 파생한다(fetch_html·extract 오류는 무시). */
export function failuresFromJob(job: Job): G2bFailureInput[] {
  if (job.type !== 'collect' && job.type !== 'download_retry') return [];
  if (job.status !== 'failed' && job.status !== 'partial') return [];
  const common = {
    ...(job.ref?.noticeNo ? { noticeNo: job.ref.noticeNo } : {}),
    ...(job.ref?.round ? { round: job.ref.round } : {}),
    ...(job.noticeId ? { noticeId: job.noticeId } : {}),
    jobId: job.id,
  };
  const out: G2bFailureInput[] = [];
  const e = job.errors[0];
  if (e && e.step === 'fetch_basic' && (e.code.startsWith('G2B_') || e.code.startsWith('PRESPEC_'))) {
    out.push({ flow: 'collect', stage: e.code.startsWith('PRESPEC_') ? 'prespec' : 'fetch_basic', code: e.code, message: e.message, ...common });
  }
  const atts = (job.result as CollectResult | undefined)?.attachments;
  const failed = Array.isArray(atts) ? atts.filter((a) => a.status === 'failed' || a.status === 'size_mismatch') : [];
  if (failed.length > 0) {
    const list = failed.map((a) => `${a.name}: ${a.error ?? a.status}`).join('; ');
    out.push({ flow: 'attachment', stage: 'download', code: 'ATTACH_FAILED', message: `${failed.length}건 실패: ${list}`, ...common });
  }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 복사용 텍스트: 한 줄/건, 없는 필드는 칸 생략. */
export function formatFailures(items: G2bFailure[]): string {
  return items.map((f) => {
    const cols: string[] = [
      fmtTime(f.at),
      `${f.flow}/${f.stage}`,
    ];
    if (f.noticeNo) cols.push(f.round ? `${f.noticeNo}-${f.round}` : f.noticeNo);
    cols.push(f.code);
    if (f.step !== undefined) cols.push(`단계${f.step}`);
    if (f.httpStatus !== undefined) cols.push(`HTTP ${f.httpStatus}`);
    if (f.tab) cols.push(G2B_TAB_LABEL[f.tab]);
    cols.push(f.message);
    if (f.g2bMsg) cols.push(`g2b: ${f.g2bMsg}`);
    if (f.endpoint) cols.push(f.endpoint);
    if (f.count > 1) cols.push(`×${f.count}`);
    return cols.join(' | ');
  }).join('\n');
}
