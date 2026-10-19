import { describe, expect, it } from 'vitest';
import type { BasicFacts, EvalFacts } from '../../src/core/model/notice-summary';
import type { Job, JobEvent, JobLog, JobStatus, StepState } from '../../src/core/types/job';
import { historyView } from '../../src/entrypoints/sidepanel/history-view';

let seq = 0;
const at = (s: number) => new Date(2026, 9, 19, 14, 31, s).toISOString();
type Ev = { [K in JobEvent['kind']]: Omit<Extract<JobEvent, { kind: K }>, 'seq' | 'at' | 'attempt'> }[JobEvent['kind']];
const ev = (s: number, e: Ev, attempt = 1): JobEvent => ({ seq: ++seq, at: at(s), attempt, ...e }) as JobEvent;
const log = (...events: JobEvent[]): JobLog => ({ jobId: 'j1', seq, events });
const job = (status: JobStatus, p: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', status, steps: [], attempt: 1, createdAt: at(0), updatedAt: at(0), errors: [], ...p,
});
const step = (s: number, id: Extract<JobEvent, { kind: 'step' }>['step'], status: 'running' | 'done' | 'failed' | 'skipped', label: string, extra: { ms?: number; attempt?: number } = {}) =>
  ev(s, { kind: 'step', step: id, status, label, ...(extra.ms !== undefined ? { ms: extra.ms } : {}) }, extra.attempt ?? 1);
const file = (s: number, phase: 'start' | 'end', name: string, extra: { status?: string; ms?: number; error?: string; step?: 'download_attachments' | 'extract' } = {}) =>
  ev(s, { kind: 'file', step: extra.step ?? 'download_attachments', phase, file: { id: name, name, size: 412 * 1024 }, ...(extra.status ? { status: extra.status } : {}), ...(extra.ms !== undefined ? { ms: extra.ms } : {}), ...(extra.error ? { error: extra.error } : {}) });
const get = (v: ReturnType<typeof historyView>, id: string) => v.steps.find((s) => s.id === id)!;

describe('historyView', () => {
  it('단계 순서가 고정이고 이벤트가 없으면 모두 pending', () => {
    const v = historyView({ log: null, job: job('running'), hasSummary: false });
    expect(v.steps.map((s) => s.name)).toEqual(['상세화면 읽기', '공고정보 조회', '첨부파일 다운로드', '평가정보 추출', '후속 처리']);
    expect(v.steps.every((s) => s.state === 'pending')).toBe(true);
    expect(v.runningId).toBeNull();
  });
  it('회차 분리: 최신 회차가 선택되고 이전 회차를 고를 수 있다', () => {
    const l = log(
      ev(0, { kind: 'attempt', label: '수집 시작' }),
      step(1, 'fetch_basic', 'done', '조회 완료', { ms: 600 }),
      step(2, 'download_attachments', 'failed', '첨부 1건 실패'),
      ev(3, { kind: 'finish', status: 'partial' }),
      ev(10, { kind: 'attempt', label: '다시 시도' }, 2),
      step(11, 'download_attachments', 'running', '받는 중', { attempt: 2 }),
    );
    const j = job('running', { attempt: 2 });
    const v = historyView({ log: l, job: j, hasSummary: false });
    expect(v.runs.map((r) => r.attempt)).toEqual([2, 1]);
    expect(v.runs[0]!.label).toMatch(/^\d\d:\d\d 수집 \(2회차\)$/);
    expect(v.runs[1]!.label).toMatch(/\(1회차, 일부 실패\)$/);
    expect(v.selected).toBe(2);
    expect(get(v, 'download_attachments').state).toBe('running');
    const prev = historyView({ log: l, job: j, hasSummary: false, attempt: 1 });
    expect(get(prev, 'download_attachments').state).toBe('failed');
    expect(prev.live).toBe(false);
  });
  it('반복 running 이벤트가 있어도 줄이 늘지 않고 단계는 한 번만 나온다', () => {
    const l = log(step(0, 'fetch_basic', 'running', '조회 중'), step(1, 'fetch_basic', 'done', '조회 완료', { ms: 700 }));
    const s = get(historyView({ log: l, job: job('running'), hasSummary: false }), 'fetch_basic');
    expect(s.lines.map((x) => x.text)).toEqual(['조회 중', '조회 완료']);
    expect(s.state).toBe('done');
    expect(s.dur).toBe('0.7초');
  });
  it('carried: 현재 회차에 이벤트가 없고 이전 회차에서 done이면 carried', () => {
    const l = log(
      step(0, 'fetch_basic', 'done', '조회 완료', { ms: 500 }),
      step(1, 'download_attachments', 'failed', '실패'),
      step(10, 'download_attachments', 'running', '받는 중', { attempt: 2 }),
    );
    const v = historyView({ log: l, job: job('running', { attempt: 2 }), hasSummary: false });
    const b = get(v, 'fetch_basic');
    expect(b).toMatchObject({ carried: true, state: 'done', dur: '이전 회차에서 완료' });
    expect(get(v, 'extract').carried).toBe(false);
    expect(get(v, 'extract').state).toBe('pending');
  });
  it('live ratio: 받는 중 파일 줄은 job.steps bytes 비율', () => {
    const steps: StepState[] = [{ id: 'download_attachments', status: 'running', bytes: { received: 250, total: 1000, name: 'a.pdf' } }];
    const l = log(step(0, 'download_attachments', 'running', '받는 중'), file(1, 'start', 'a.pdf'), file(1, 'start', 'b.hwp'));
    const v = historyView({ log: l, job: job('running', { steps }), hasSummary: false });
    const lines = get(v, 'download_attachments').lines;
    expect(lines[1]).toMatchObject({ name: 'a.pdf', tone: 'live', ratio: 0.25, text: '받는 중' });
    expect(lines[2]!.ratio).toBeUndefined();
    expect(v.runningId).toBe('download_attachments');
  });
  it('파일 start/end는 한 줄로 합쳐지고 실패는 오류 상자', () => {
    const l = log(
      step(0, 'download_attachments', 'running', '받는 중'),
      file(1, 'start', 'a.pdf'), file(2, 'end', 'a.pdf', { status: 'saved', ms: 400 }),
      file(3, 'start', 'b.hwp'), file(4, 'end', 'b.hwp', { status: 'failed', error: '시간 초과' }),
    );
    const lines = get(historyView({ log: l, job: job('running'), hasSummary: false }), 'download_attachments').lines;
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({ name: 'a.pdf', tone: 'good', text: '0.4초', size: '412KB' });
    expect(lines[2]).toMatchObject({ name: 'b.hwp', tone: 'bad', error: { message: '시간 초과' } });
  });
  it('end만 있는 파일 줄(이미 저장된 파일 skip)도 완료 줄 하나', () => {
    const l = log(step(0, 'download_attachments', 'running', '받는 중'), file(1, 'end', 'a.pdf', { status: 'saved' }));
    const lines = get(historyView({ log: l, job: job('running'), hasSummary: false }), 'download_attachments').lines;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ name: 'a.pdf', tone: 'good' });
    expect(lines[1]!.ratio).toBeUndefined();
  });
  it('진행 중 단계 id: 추출 단계가 running이면 extract', () => {
    const l = log(
      step(0, 'fetch_basic', 'done', '완료', { ms: 100 }), step(1, 'download_attachments', 'done', '완료', { ms: 100 }),
      step(2, 'extract', 'running', '추출 중'), file(3, 'start', 'a.pdf', { step: 'extract' }),
    );
    const v = historyView({ log: l, job: job('running'), hasSummary: false });
    expect(v.runningId).toBe('extract');
    expect(get(v, 'extract').lines[1]).toMatchObject({ name: 'a.pdf', tone: 'live' });
  });
  it('facts: 공고정보는 값 행과 D-day, 평가정보는 확인 필요 표시', () => {
    const basic: BasicFacts = {
      kind: 'bid', noticeNo: 'N', round: '000', title: 't', orderingOrg: '도 건설본부', demandOrg: null, estimatedPrice: 1_284_000_000,
      contractMethod: null, awardMethod: '적격심사', jointVentureAllowed: true, eligibility: null, projectPeriod: null,
      bidCloseAt: new Date(2099, 0, 1, 10).toISOString(), openingAt: null, attachmentCount: 4,
    };
    const ex = { value: 5, status: 'needs_review' as const, needsCheck: true };
    const ok = { value: 15, status: 'verified' as const, needsCheck: false };
    const evalF: EvalFacts = {
      items: { performanceScore: ok, managementScore: { ...ok, value: null }, credibilityScore: ok, performancePeriod: { ...ex, value: '5년' }, performanceMinAmount: ok, differentialScoring: { value: true, status: 'verified', needsCheck: false } },
      reviewCount: 1, conflictCount: 0, extractionStatus: 'needs_review',
    };
    const l = log(
      ev(0, { kind: 'facts', step: 'fetch_basic', facts: basic }),
      ev(1, { kind: 'facts', step: 'extract', facts: evalF }),
    );
    const v = historyView({ log: l, job: job('running'), hasSummary: false });
    const b = get(v, 'fetch_basic').facts;
    expect(b.map((r) => r.label)).toEqual(['발주기관', '추정가격', '낙찰방법', '공동도급', '입찰마감']);
    expect(b.find((r) => r.label === '입찰마감')?.dday).toMatch(/^D-\d+$/);
    const e = get(v, 'extract').facts;
    expect(e.find((r) => r.label === '실적 기간')).toMatchObject({ value: '5년', check: true });
    expect(e.find((r) => r.label === '경영상태')).toBeUndefined();
  });
  it('기본 펼침 규칙 4가지', () => {
    const l = log(step(0, 'fetch_basic', 'done', '완료', { ms: 1 }));
    expect(historyView({ log: l, job: job('completed'), hasSummary: true }).defaultOpen).toBe(false);
    expect(historyView({ log: l, job: job('completed'), hasSummary: false }).defaultOpen).toBe(true);
    expect(historyView({ log: l, job: job('running'), hasSummary: false }).defaultOpen).toBe(true);
    expect(historyView({ log: l, job: job('partial'), hasSummary: true }).defaultOpen).toBe(true);
  });
  it('절단 후(파일 이벤트 없음)에도 step과 finish가 남아 요약이 나온다', () => {
    const l = log(
      ev(0, { kind: 'attempt', label: '수집 시작' }),
      step(1, 'download_attachments', 'done', '완료', { ms: 3000 }),
      ev(6, { kind: 'finish', status: 'completed' }),
    );
    const result = { noticeId: 'n', folder: 'f', attachments: [{ name: 'a', savedName: 'a', status: 'saved', size: 1 }] };
    const v = historyView({ log: l, job: job('completed', { result }), hasSummary: true });
    expect(get(v, 'download_attachments')).toMatchObject({ state: 'done', dur: '3.0초', lines: [{ text: '완료' }] });
    expect(v.summary).toBe('완료, 6.0초, 첨부 1/1');
  });
  it('끝난 회차에 running으로 남은 단계는 중단(failed)으로 본다', () => {
    const l = log(step(0, 'extract', 'running', '추출 중'), ev(1, { kind: 'finish', status: 'interrupted' }));
    const v = historyView({ log: l, job: job('interrupted'), hasSummary: false });
    expect(get(v, 'extract').state).toBe('failed');
    expect(v.runningId).toBeNull();
  });
  it('후속 처리: handoff 이벤트 문구', () => {
    const l = log(ev(0, { kind: 'handoff', handoff: { action: 'review', reasons: ['needs_review'], opened: true, at: at(0) } }));
    const s = get(historyView({ log: l, job: job('completed'), hasSummary: true }), 'handoff');
    expect(s.state).toBe('done');
    expect(s.lines[0]!.text).toContain('검수 필요');
  });
});
