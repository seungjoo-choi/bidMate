import { Copy, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  G2B_FLOWS, G2B_FLOW_LABEL, G2B_TAB_LABEL, formatFailures, type G2bFailure, type G2bFlow,
} from '../../../core/diagnostics/g2b-failure';
import { send } from '../../../messaging/bus';
import { Button, EmptyState, Select, StatusBadge } from '../../../ui/components';
import { useG2bFailures } from '../../../ui/hooks/useG2bFailures';
import { RawDetails, errText } from './parts';

const FLOW_OPTIONS = [{ value: '', label: '전체' }, ...G2B_FLOWS.map((f) => ({ value: f, label: G2B_FLOW_LABEL[f] }))];

const pad = (n: number) => String(n).padStart(2, '0');

/** 오늘이면 HH:mm:ss, 아니면 MM-DD HH:mm:ss */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return d.toDateString() === new Date().toDateString() ? hms : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms}`;
}

function Row({ f }: { f: G2bFailure }) {
  const details: Array<[string, string | number | undefined]> = [
    ['endpoint', f.endpoint], ['g2b 응답', f.g2bMsg], ['trigger', f.trigger], ['jobId', f.jobId],
    ['noticeId', f.noticeId], ['소요(ms)', f.ms], ['최초', f.at], ['마지막', f.lastAt],
  ];
  return (
    <li className="space-y-1.5 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="tabular-nums" title={f.at}>{timeOf(f.at)}</span>
        <StatusBadge status="error">{G2B_FLOW_LABEL[f.flow] ?? f.flow}</StatusBadge>
        <span>{f.stage}{f.step !== undefined && ` · 단계 ${f.step}`}</span>
        {f.noticeNo && <span className="font-mono">{f.noticeNo}{f.round ? `-${f.round}` : ''}</span>}
        <span className="font-mono">{f.code}</span>
        {f.httpStatus !== undefined && <span className="tabular-nums">HTTP {f.httpStatus}</span>}
        {f.tab && <span>{G2B_TAB_LABEL[f.tab] ?? f.tab}</span>}
        {f.count > 1 && <span className="font-semibold tabular-nums">×{f.count}</span>}
      </div>
      <div className="text-sm wrap-anywhere">{f.message}</div>
      <RawDetails summary="자세히">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {details.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono wrap-anywhere">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </RawDetails>
    </li>
  );
}

export function G2bFailuresTool() {
  const all = useG2bFailures();
  const [flow, setFlow] = useState<G2bFlow | ''>('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => (flow ? all.filter((f) => f.flow === flow) : all), [all, flow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatFailures(items));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(errText(e));
    }
  };

  const clear = async () => {
    if (!window.confirm('실패 기록을 모두 지울까요?')) return;
    try {
      await send('diag/g2b-failures-clear', undefined);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted">나라장터와 통신하다 실패한 기록입니다. 응답 본문은 저장하지 않습니다. 최근 300건, 30일 보관.</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select aria-label="흐름" className="w-52" value={flow} options={FLOW_OPTIONS} onChange={(v) => setFlow(v as G2bFlow | '')} />
          <Button variant="secondary" icon={<Copy />} disabled={items.length === 0} onClick={() => void copy()}>{copied ? '복사됨' : '복사'}</Button>
          <Button variant="secondary" icon={<Trash2 />} disabled={all.length === 0} onClick={() => void clear()}>지우기</Button>
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
      {items.length === 0 ? (
        <EmptyState title="실패 기록이 없습니다" size="sm" />
      ) : (
        <ul className="divide-y divide-line rounded-ctl border border-line bg-sunken">
          {items.map((f) => <Row key={f.id} f={f} />)}
        </ul>
      )}
    </div>
  );
}
