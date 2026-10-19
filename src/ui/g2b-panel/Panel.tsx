import { AlertTriangle, CheckCircle2, Copy, Download, Loader2, X, XCircle } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PanelController } from './controller';
import type { HandoffView } from '../handoff-view';
import { panelView, type PanelView } from './panel-view';

const CARD_SHADOW = '0 8px 24px rgba(15,23,42,.12)';
const AUTO_COLLAPSE_MS = 6000;
const FOREIGN_DONE_MS = 3000;

function Btn({ tone = 'ghost', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ghost' | 'danger' | 'primary' }) {
  const t = tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700'
    : tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100';
  return <button type="button" {...rest} className={`inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${t} ${className}`} />;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="tm-in w-[320px] rounded-xl border border-slate-200 bg-white p-3" style={{ boxShadow: CARD_SHADOW }}>
      {children}
    </div>
  );
}

const HANDOFF_TEXT: Record<HandoffView['tone'], string> = {
  ok: 'text-green-700', warn: 'text-amber-600', error: 'text-red-600', info: 'text-slate-600',
};

/** 자동 메일 작성/검수 처리 한 줄 + 버튼 */
function HandoffLine({ h, ctl }: { h: HandoffView; ctl: PanelController }) {
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
      <div className={`min-w-0 flex-1 text-xs ${HANDOFF_TEXT[h.tone]}`} title={h.text}>{h.text}</div>
      {h.action !== 'none' && h.actionLabel && <Btn onClick={() => void ctl.handoffAction(h.action)}>{h.actionLabel}</Btn>}
    </div>
  );
}

function Done({ view, ctl }: { view: Extract<PanelView, { kind: 'completed' | 'partial' }>; ctl: PanelController }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (view.folder) void navigator.clipboard?.writeText(view.folder).then(() => setCopied(true)).catch(() => undefined);
  };
  const ok = view.kind === 'completed';
  return (
    <>
      <div className="flex items-start gap-2">
        {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{view.headline}</div>
          {view.title && <div className="truncate text-xs text-slate-500" title={view.title}>{view.title}</div>}
        </div>
        <Btn aria-label="닫기" className="!px-1.5" onClick={() => ctl.dismissJob()}><X className="size-4" /></Btn>
      </div>
      {view.kind === 'partial' && (
        <ul className="mt-2 space-y-1">
          {view.failures.map((f, i) => (
            <li key={i} className="text-xs">
              <div className="truncate font-medium" title={f.name}>{f.name}</div>
              <div className="truncate text-slate-500" title={f.reason}>{f.reason}</div>
            </li>
          ))}
          {view.moreCount > 0 && <li className="text-xs text-slate-500">외 {view.moreCount}건</li>}
        </ul>
      )}
      {view.extractionLine && (
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-xs">{view.extractionLine}</div>
          {view.reviewNoticeId && <Btn onClick={() => ctl.openUi('review', view.reviewNoticeId)}>검수</Btn>}
        </div>
      )}
      {view.folder && (
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-xs text-slate-500" title={view.folder}>{view.folder}</div>
          <Btn onClick={copy}><Copy className="size-3.5" />{copied ? '복사됨' : '경로 복사'}</Btn>
        </div>
      )}
      {view.kind === 'partial' && view.canRetry && (
        <div className="mt-2 flex justify-end"><Btn tone="primary" onClick={() => void ctl.retry()}>{view.retryLabel}</Btn></div>
      )}
      {view.kind === 'partial' && !view.canRetry && <div className="mt-2 text-xs text-slate-500">해당 공고 화면에서 다시 시도하세요</div>}
      {view.handoff && <HandoffLine h={view.handoff} ctl={ctl} />}
    </>
  );
}

export function PanelApp({ controller: ctl }: { controller: PanelController }) {
  const st = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const [minimized, setMinimized] = useState(false);
  const [hover, setHover] = useState(false);
  const view = panelView(st.job, st.lookup, { title: st.title, current: st.notice, compose: st.compose });
  const handoffKind = view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error' ? view.handoff?.kind : undefined;

  // 완료 6초 뒤 자동 축소(마우스가 위에 있으면 정지). partial/error는 축소하지 않는다.
  useEffect(() => {
    // 다른 공고의 잡은 종료 알림을 3초만 보여 주고 현재 공고의 대기 pill로 돌아간다.
    const foreignDone = view.kind !== 'idle' && view.kind !== 'progress' && view.foreign;
    if (!foreignDone && view.kind !== 'completed') return;
    if (hover && !foreignDone) return;
    // 자동 메일 작성이 대기/진행 중이면 접지 않고, 종결된 뒤에 적용한다.
    if (!foreignDone && (handoffKind === 'queued' || handoffKind === 'composing')) return;
    const t = setTimeout(() => ctl.dismissJob(), foreignDone ? FOREIGN_DONE_MS : AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [view.kind, hover, ctl, st.job?.id, handoffKind]);

  // 새 잡이 시작되면 최소화를 풀어 준다.
  useEffect(() => { setMinimized(false); }, [st.job?.id]);

  const visible = st.notice !== null || view.kind === 'progress' || st.orphaned;
  if (!visible) return null;

  const note = st.startError ?? (st.otherTab ? '이 공고가 다른 탭에서 수집 중입니다' : null);
  let body: ReactNode;
  if (view.kind === 'idle') {
    body = (
      <div key="idle" className="tm-in flex items-center gap-2">
        {view.chip && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{view.chip}</span>}
        <button
          type="button" disabled={st.starting} onClick={() => void ctl.collect()}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-blue-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          style={{ boxShadow: CARD_SHADOW }}
        >
          {st.starting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {view.buttonLabel}
        </button>
      </div>
    );
        if (st.orphaned) {
      body = <div className="flex flex-col items-end gap-2">
        <div className="max-w-[320px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-600" style={{ boxShadow: CARD_SHADOW }}>확장이 업데이트되었습니다. 페이지를 새로고침하세요</div>
      </div>;
    } else if (note) {
      body = <div className="flex flex-col items-end gap-2">
        <div className="max-w-[320px] rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600" style={{ boxShadow: CARD_SHADOW }}>{note}</div>
        {body}
      </div>;
    }
  } else if (view.kind === 'progress') {
    body = minimized ? (
      <button
        key="pill" type="button" onClick={() => setMinimized(false)}
        className="tm-in inline-flex h-10 items-center gap-2 rounded-full bg-blue-600 px-4 text-[13px] font-medium text-white"
        style={{ boxShadow: CARD_SHADOW }}
      >
        <Loader2 className="size-4 animate-spin" />{view.pillText}
      </button>
    ) : (
      <Card key="progress">
        {view.foreignLabel && <div className="mb-1 truncate text-xs text-slate-500" title={view.foreignLabel}>{view.foreignLabel}</div>}
        <div className="flex items-start gap-2">
          <div className="line-clamp-2 min-w-0 flex-1 font-semibold" title={view.title}>{view.title ?? '공고 수집 중'}</div>
          <Btn aria-label="최소화" className="!px-1.5" onClick={() => setMinimized(true)}><X className="size-4" /></Btn>
        </div>
        <div className="mt-1 break-all text-xs text-slate-500">{view.label}</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="tm-bar h-full rounded-full bg-blue-600" style={{ width: `${Math.round(view.ratio * 100)}%`, transition: 'width 200ms' }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-slate-600">
            {view.attach && <span>첨부 {view.attach.done}/{view.attach.total}</span>}
            {view.errorCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">오류 {view.errorCount}</span>}
          </span>
          {view.cancelling ? (
            <span className="flex items-center gap-1">
              <span className="text-amber-500">취소 중…</span>
              <Btn tone="danger" onClick={() => void ctl.cancel(true)}>강제 중단</Btn>
            </span>
          ) : (
            <Btn onClick={() => void ctl.cancel(false)}>취소</Btn>
          )}
        </div>
      </Card>
    );
  } else if (view.kind === 'completed' || view.kind === 'partial') {
    body = <Card key={view.kind}><Done view={view} ctl={ctl} /></Card>;
  } else {
    body = (
      <Card key="error">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{view.message}</div>
            {view.detail && <div className="mt-0.5 break-all text-xs text-slate-500">{view.detail}</div>}
          </div>
          <Btn aria-label="닫기" className="!px-1.5" onClick={() => ctl.dismissJob()}><X className="size-4" /></Btn>
        </div>
        {view.hint && <div className="mt-2 text-xs text-slate-500">{view.hint}</div>}
        {view.handoff && <HandoffLine h={view.handoff} ctl={ctl} />}
        {view.action !== 'none' && (
          <div className="mt-2 flex justify-end">
            <Btn tone="primary" onClick={() => {
              if (view.action === 'grant') ctl.openUi('grant');
              else if (view.action === 'settings') ctl.openFix(view.fix);
              else void ctl.retry();
            }}>{view.actionLabel}</Btn>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 2147483000 }}
    >
      <div className="flex flex-col items-end gap-2">
        {view.kind !== 'idle' && note && (
          <div className="max-w-[320px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-600" style={{ boxShadow: CARD_SHADOW }}>{note}</div>
        )}
        {body}
      </div>
    </div>
  );
}
