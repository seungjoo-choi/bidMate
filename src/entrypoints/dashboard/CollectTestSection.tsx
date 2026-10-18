import { Download, OctagonX, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../adapters/g2b/openapi';
import type { CollectResult, Job } from '../../core/types/job';
import { send } from '../../messaging/bus';
import { Button, Card, Field, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useJobs } from '../../ui/hooks/useJobs';

const STEP_LABEL: Record<string, string> = {
  fetch_basic: '공고정보 조회', download_attachments: '첨부파일 다운로드', fetch_html: '화면정보 병합',
};
const stepTone = (s: string) => (s === 'done' ? 'ok' : s === 'failed' ? 'error' : s === 'running' ? 'warn' : 'idle') as 'ok' | 'error' | 'warn' | 'idle';
const jobTone = (s: string) => (s === 'completed' ? 'ok' : s === 'cancelling' ? 'warn' : s === 'failed' || s === 'interrupted' ? 'error' : s === 'partial' ? 'warn' : 'idle') as 'ok' | 'error' | 'warn' | 'idle';
const fmt = (n: number | null) => (n === null ? '-' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

function JobView({ job, onRetry, onCancel }: { job: Job; onRetry: () => void; onCancel: (force: boolean) => void }) {
  const result = job.result as CollectResult | undefined;
  return (
    <div className="space-y-3 rounded-ctl border border-line bg-sunken inset-shadow-sunken p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{job.noticeId} <span className="text-muted">(시도 {job.attempt})</span></div>
        <div className="flex items-center gap-2">
          <StatusBadge status={jobTone(job.status)}>{job.status === 'cancelling' ? '취소 중…' : job.status}</StatusBadge>
          {(job.status === 'queued' || job.status === 'running') && (
            <Button variant="secondary" icon={<X />} onClick={() => onCancel(false)}>취소</Button>
          )}
          {job.status === 'cancelling' && (
            <Button variant="secondary" icon={<OctagonX />} onClick={() => onCancel(true)}>강제 중단</Button>
          )}
          {(job.status === 'failed' || job.status === 'partial' || job.status === 'interrupted') && (
            <Button variant="secondary" icon={<RotateCcw />} onClick={onRetry}>재시도</Button>
          )}
        </div>
      </div>
      {job.label && (job.status === 'running' || job.status === 'cancelling') && (
        <div className="break-all text-xs text-muted">{job.label}</div>
      )}
      <ul className="space-y-1 text-sm">
        {job.steps.map((s) => (
          <li key={s.id} className="flex items-center justify-between">
            <span>{STEP_LABEL[s.id] ?? s.id}{s.status === 'skipped' && s.id === 'fetch_html' ? ' — 건너뜀(화면정보 없음)' : ''}{s.progress ? ` (${s.progress.done}/${s.progress.total})` : ''}</span>
            <StatusBadge status={stepTone(s.status)}>{s.status}</StatusBadge>
          </li>
        ))}
      </ul>
      {job.errors.map((e, i) => (
        <InlineAlert key={i} tone="error">{e.code}: {e.message}{e.retryable ? ' (재시도 가능)' : ''}</InlineAlert>
      ))}
      {result && (
        <div className="space-y-2">
          <div className="text-sm">{result.title}</div>
          <div className="break-all text-xs text-muted">저장 폴더: {result.folder}</div>
          <ul className="space-y-1 text-sm">
            {result.attachments.map((a) => (
              <li key={a.name} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted">{fmt(a.size)}</span>
                  <StatusBadge status={a.status === 'saved' ? 'ok' : a.status === 'skipped' ? 'idle' : a.status === 'pending' || a.status === 'downloading' ? 'warn' : 'error'}>{a.status}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CollectTestSection() {
  const jobs = useJobs();
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
      setError(e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e));
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
    <Card title="수집 테스트" description="나라장터 공고번호로 공고정보와 첨부파일을 저장 폴더에 수집합니다. (Stage B 전 검증용)">
      <Field label="공고번호" htmlFor="collect-no">
        <input id="collect-no" className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button icon={<Download />} loading={busy} onClick={collect}>수집</Button>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      <div className="space-y-3">
        {jobs.filter((j) => j.type === 'collect').map((j) => (
          <JobView key={j.id} job={j} onRetry={() => void start({ type: 'collect', retryOf: j.id })} onCancel={(force) => void cancel(j.id, force)} />
        ))}
      </div>
    </Card>
  );
}
