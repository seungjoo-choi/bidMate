import { Download, OctagonX, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../../adapters/g2b/openapi';
import type { AttachmentStatus } from '../../../core/types/notice';
import type { CollectResult, Job, JobStatus, StepState } from '../../../core/types/job';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert, StatusBadge, type BadgeStatus } from '../../../ui/components';
import { useJobs } from '../../../ui/hooks/useJobs';
import { Metrics, NoticeInput, ResultBlock, errText } from './parts';

const STEP_LABEL: Record<string, string> = {
  fetch_basic: '공고정보 조회', download_attachments: '첨부파일 다운로드', fetch_html: '화면정보 병합',
};

const JOB: Record<JobStatus, [BadgeStatus, string]> = {
  queued: ['idle', '대기'], running: ['warn', '진행 중'], cancelling: ['warn', '취소 중…'], completed: ['ok', '완료'],
  partial: ['warn', '일부 실패'], failed: ['error', '실패'], cancelled: ['idle', '취소됨'], interrupted: ['error', '중단됨'],
};
const STEP: Record<StepState['status'], [BadgeStatus, string]> = {
  pending: ['idle', '대기'], running: ['warn', '진행 중'], done: ['ok', '완료'], failed: ['error', '실패'], skipped: ['idle', '건너뜀'],
};
const FILE: Record<AttachmentStatus, [BadgeStatus, string]> = {
  pending: ['warn', '대기'], downloading: ['warn', '받는 중'], saved: ['ok', '저장'], failed: ['error', '실패'],
  skipped: ['idle', '건너뜀'], size_mismatch: ['error', '크기 다름'],
};
const fmt = (n: number | null) => (n === null ? '-' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

function JobView({ job, onRetry, onCancel }: { job: Job; onRetry: () => void; onCancel: (force: boolean) => void }) {
  const result = job.result as CollectResult | undefined;
  const [tone, label] = JOB[job.status];
  const saved = result?.attachments.filter((a) => a.status === 'saved').length ?? 0;
  return (
    <ResultBlock
      tone={tone}
      title={<>{label} <span className="ml-1 font-mono font-normal text-ink">{job.noticeId}</span></>}
      meta={
        <>
          시도 {job.attempt}
          {(job.status === 'queued' || job.status === 'running') && (
            <Button variant="secondary" icon={<X />} onClick={() => onCancel(false)}>취소</Button>
          )}
          {job.status === 'cancelling' && (
            <Button variant="secondary" icon={<OctagonX />} onClick={() => onCancel(true)}>강제 중단</Button>
          )}
          {(job.status === 'failed' || job.status === 'partial' || job.status === 'interrupted') && (
            <Button variant="secondary" icon={<RotateCcw />} onClick={onRetry}>재시도</Button>
          )}
        </>
      }
    >
      {result && <div className="font-medium wrap-anywhere">{result.title}</div>}
      {job.label && (job.status === 'running' || job.status === 'cancelling') && (
        <div className="text-xs text-muted wrap-anywhere">{job.label}</div>
      )}
      <ol className="grid gap-1.5">
        {job.steps.map((s) => {
          const [st, sl] = STEP[s.status];
          return (
            <li key={s.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                {STEP_LABEL[s.id] ?? s.id}
                {s.status === 'skipped' && s.id === 'fetch_html' && <span className="text-muted"> · 화면정보 없음</span>}
                {s.progress && <span className="text-muted tabular-nums"> · {s.progress.done}/{s.progress.total}</span>}
              </span>
              <StatusBadge status={st}>{sl}</StatusBadge>
            </li>
          );
        })}
      </ol>
      {job.errors.map((e, i) => (
        <InlineAlert key={i} tone="error">{e.code}: {e.message}{e.retryable ? ' (재시도 가능)' : ''}</InlineAlert>
      ))}
      {result && (
        <div className="space-y-2 border-t border-line pt-3">
          <Metrics items={[['첨부', result.attachments.length], ['저장', saved]]} />
          <div className="text-xs text-muted wrap-anywhere">저장 폴더 {result.folder}</div>
          {result.attachments.length > 0 && (
            <ul className="grid gap-1">
              {result.attachments.map((a) => {
                const [ft, fl] = FILE[a.status];
                return (
                  <li key={a.name} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate" title={a.error ?? a.name}>{a.name}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted tabular-nums">{fmt(a.size)}</span>
                      <StatusBadge status={ft}>{fl}</StatusBadge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </ResultBlock>
  );
}

export function CollectTool() {
  const jobs = useJobs().filter((j) => j.type === 'collect');
  const [text, setText] = useState('R26BK01722175-000');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (req: Parameters<typeof send<'job/start'>>[1]) => {
    setError(null);
    setBusy(true);
    try {
      const r = await send('job/start', req);
      if (r.code) setError(`${r.code}: 같은 공고의 잡이 이미 진행 중입니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (jobId: string, force: boolean) => {
    setError(null);
    try {
      await send('job/cancel', { jobId, force });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const collect = () => {
    const ref = resolveRef(text);
    if (!ref) { setError('공고번호 형식이 올바르지 않습니다. 예: R26BK01722175-000'); return; }
    void start({ type: 'collect', ref });
  };

  return (
    <div className="space-y-4">
      <NoticeInput id="diag-collect-no" value={text} onChange={setText} help="공고정보와 첨부파일을 실제로 받아 저장 폴더에 저장합니다.">
        <Button icon={<Download />} loading={busy} onClick={collect}>수집</Button>
      </NoticeInput>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {jobs.map((j) => (
        <JobView key={j.id} job={j} onRetry={() => void start({ type: 'collect', retryOf: j.id })} onCancel={(force) => void cancel(j.id, force)} />
      ))}
    </div>
  );
}
