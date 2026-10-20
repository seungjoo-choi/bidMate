import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { LogStep } from '../../core/types/job';
import type { FactRow, HistoryLine, HistoryStep, HistoryView, NodeState } from './history-view';

type Pal = { bg: string; fg: string; hi: string; mk: string };
/** 상태별 색. 단계 아이콘은 그대로 두고 원 색과 배지로만 상태를 구분한다 */
const PAL: Record<NodeState, Pal> = {
  running: { bg: 'var(--color-primary)', fg: '#fff', hi: 'var(--color-mark)', mk: 'var(--color-mark-strong)' },
  done: { bg: 'var(--color-ok-wash)', fg: 'var(--color-ok)', hi: 'var(--color-ok)', mk: 'var(--color-ok)' },
  failed: { bg: 'var(--color-danger-wash)', fg: 'var(--color-danger)', hi: 'var(--color-danger)', mk: 'var(--color-danger)' },
  pending: { bg: 'var(--color-sunken)', fg: 'var(--color-faint)', hi: 'var(--color-faint)', mk: 'var(--color-faint)' },
  skipped: { bg: 'var(--color-sunken)', fg: 'var(--color-faint)', hi: 'var(--color-faint)', mk: 'var(--color-faint)' },
};
const stroke = (c: string) => ({ stroke: c, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }) as const;
const anim = (on: boolean, name: string) => (on ? `sp-mv ${name}` : undefined);

/** 단계 고유 그림. 진행 중일 때만 움직인다 */
function Glyph({ id, p, on }: { id: LogStep; p: Pal; on: boolean }) {
  const W = stroke(p.fg);
  switch (id) {
    case 'fetch_html':
      return <g className={anim(on, 'sp-a-search')} {...W}><circle cx="11" cy="11" r="3.6" /><path d="M13.7 13.7l2.6 2.6" /></g>;
    case 'fetch_basic':
      return <><g {...W}><rect x="7.5" y="6" width="9" height="12" rx="1.5" /></g><path className={anim(on, 'sp-a-scan')} d={on ? 'M6 12h12' : 'M10 12h4'} stroke={p.hi} strokeWidth="1.8" strokeLinecap="round" /></>;
    case 'download_attachments':
      return <><g className={anim(on, 'sp-a-down')} {...W}><path d="M12 6.5v7" /><path d="M9 11l3 3 3-3" /></g><path d="M7.5 17.2h9" {...W} /></>;
    case 'extract':
      return <><g {...W}><rect x="7.5" y="6" width="9" height="12" rx="1.5" /><path d="M10 9.5h4M10 15h3" /></g><rect className={anim(on, 'sp-a-mark')} x="9.3" y="11.2" width="5.4" height="1.8" rx=".9" fill={p.mk} /></>;
    case 'handoff':
      return <g className={anim(on, 'sp-a-fly')} {...W}><path d="M6.5 11.5l11-4.5-4 11-2-4.5z" /><path d="M11.5 13.5l6-6.5" /></g>;
    default:
      return null; // 수집 기록에 나오지 않는 compose 단계
  }
}

/** 오른쪽 아래 작은 상태 배지(완료 체크, 실패 X) */
function Badge({ state }: { state: NodeState }) {
  if (state === 'done') {
    return <><circle cx="19.5" cy="19.5" r="4.2" fill="var(--color-ok)" stroke="var(--color-surface)" strokeWidth="1.5" /><path d="M17.7 19.6l1.2 1.2 2.2-2.3" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>;
  }
  if (state === 'failed') {
    return <><circle cx="19.5" cy="19.5" r="4.2" fill="var(--color-danger)" stroke="var(--color-surface)" strokeWidth="1.5" /><path d="M18 18l3 3M21 18l-3 3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></>;
  }
  return null;
}

function Node({ step }: { step: HistoryStep }) {
  const on = step.state === 'running';
  const p = PAL[step.state];
  return (
    <span className={`absolute -left-0.5 top-0 grid size-6 place-items-center rounded-full [&_svg]:size-6 [&_svg]:overflow-visible ${on ? 'sp-node-run' : ''} ${step.state === 'skipped' ? 'opacity-55' : ''}`}>
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={p.bg} /><Glyph id={step.id} p={p} on={on} /><Badge state={step.state} /></svg>
    </span>
  );
}

const LINE_TEXT: Record<HistoryLine['tone'], string> = {
  normal: 'text-muted', live: 'text-ink', good: 'text-muted', bad: 'text-danger',
};

function Line({ line }: { line: HistoryLine }) {
  return (
    <li className="sp-slide grid grid-cols-[58px_1fr] gap-2 text-[0.8125rem] leading-snug">
      <time className="pt-px font-mono text-xs text-faint tabular-nums">{line.time}</time>
      <div className={`min-w-0 [overflow-wrap:anywhere] ${LINE_TEXT[line.tone]}`}>
        {line.name && <span className="text-ink">{line.name}</span>}
        {line.name && line.tone === 'good' && <i className="mr-0 ml-1.5 inline-block size-1.5 rounded-full bg-ok align-[2px]" />}
        {line.size && <span className="ml-1.5 whitespace-nowrap tabular-nums">{line.size}</span>}
        {line.text && <span className={line.name ? 'ml-1.5' : ''}>{line.text}</span>}
        {line.ratio !== undefined && (
          <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-sunken">
            <i className="block h-full bg-primary transition-[width] duration-150 ease-linear" style={{ width: `${Math.round(line.ratio * 100)}%` }} />
          </div>
        )}
        {line.error && (
          <div className="mt-1.5 rounded-ctl bg-danger-wash px-2 py-1.5 text-xs text-ink">
            {line.error.code && <b className="block font-mono font-medium text-danger">{line.error.code}</b>}
            {line.error.message}
          </div>
        )}
      </div>
    </li>
  );
}

function Facts({ rows }: { rows: FactRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="sp-slide mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-btn border border-line bg-surface px-2.5 py-1.5 text-[0.8125rem]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="whitespace-nowrap text-muted">{r.label}</dt>
          <dd className={`m-0 min-w-0 font-semibold tabular-nums [overflow-wrap:anywhere] ${r.check ? 'text-warn' : ''}`}>
            {r.value}
            {r.dday && <span className="ml-1.5 text-warn">{r.dday}</span>}
            {r.check && <span className="ml-1.5 rounded-full bg-warn-wash px-1.5 text-[0.6875rem] font-semibold">확인 필요</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface HistoryCardProps {
  view: HistoryView;
  open: boolean;
  onToggle: () => void;
  onSelectAttempt: (attempt: number) => void;
}

/** 수집 기록 카드: 접힘 헤더, 회차 선택, 단계 타임라인. */
export function HistoryCard({ view, open, onToggle, onSelectAttempt }: HistoryCardProps) {
  // 단계 제목을 눌러 접은 단계(세부 기록과 값 표를 숨긴다)
  const [shut, setShut] = useState<Set<LogStep>>(new Set());
  const toggleStep = (id: LogStep) => setShut((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="rounded-card border border-line bg-surface shadow-card">
      <div className={`flex items-center gap-2 px-3.5 py-[11px] ${open ? 'mb-1 border-b border-line' : ''}`}>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[4px] text-left text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <ChevronRight className={`size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
          <h2 className="m-0 text-[0.8125rem] font-semibold tracking-wide">수집 기록</h2>
          <span className="truncate text-xs">{view.summary}</span>
        </button>
        {open && view.runs.length > 1 && (
          <select aria-label="수집 회차" value={view.selected} onChange={(e) => onSelectAttempt(Number(e.target.value))}
            className="rounded-ctl border border-line bg-sunken px-1.5 py-0.5 text-xs text-ink">
            {view.runs.map((r) => <option key={r.attempt} value={r.attempt}>{r.label}</option>)}
          </select>
        )}
      </div>
      {open && (
        <ol className="m-0 list-none px-3.5 pt-2.5 pb-3.5">
          {view.steps.map((s, i) => {
            const last = i === view.steps.length - 1;
            const closed = shut.has(s.id);
            return (
              <li key={s.id} className={`relative pl-7 ${last ? '' : 'pb-3'}`}>
                {!last && <span className="absolute top-[22px] bottom-0 left-[9px] w-0.5 bg-line" />}
                <Node step={s} />
                <div role="button" tabIndex={0} aria-expanded={!closed} onClick={() => toggleStep(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStep(s.id); } }}
                  className="flex cursor-pointer items-baseline gap-2 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <b className={`text-sm ${s.state === 'pending' ? 'font-medium text-faint' : s.state === 'skipped' ? 'font-medium text-muted' : 'font-semibold'}`}>{s.name}</b>
                  <span className="ml-auto text-xs whitespace-nowrap text-muted tabular-nums">{s.dur}</span>
                </div>
                {!closed && s.lines.length > 0 && (
                  <ul className="m-0 mt-1 grid list-none gap-[3px] p-0">
                    {s.lines.map((l) => <Line key={l.key} line={l} />)}
                  </ul>
                )}
                {!closed && <Facts rows={s.facts} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
