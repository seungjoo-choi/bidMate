import { AlertTriangle, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, Loader2, RotateCw, X, XCircle } from 'lucide-react';
import mascotUrl from '../trackerbot/assets/bidmate-mascot.png?inline';
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PanelController } from './controller';
import type { HandoffView } from '../handoff-view';
import { panelView, type PanelView } from './panel-view';

const CARD_SHADOW = 'var(--bm-card-shadow)';
const AUTO_COLLAPSE_MS = 6000;
const FOREIGN_DONE_MS = 3000;
/** 대기 알약을 접어 둔 상태. 공고를 옮겨 다녀도 유지한다 */
const FOLD_KEY = 'g2bPanel.folded';
/** 수집 전 공고에서 "수집할까요?" 말풍선을 보여 주는 시간 */
const NUDGE_MS = 5000;

/** 대기 알약 접기 상태(chrome.storage.local). 새 잡이 시작되면 펼친다 */
function useFolded(jobId: string | undefined): [boolean, (v: boolean) => void] {
  // 처음에는 접혀 있다. 사용자가 펼쳐 두면 그 상태를 기억한다
  const [folded, setFolded] = useState(true);
  useEffect(() => {
    void chrome.storage.local.get(FOLD_KEY).then((r) => setFolded(r[FOLD_KEY] !== false), () => undefined);
  }, []);
  const set = (v: boolean) => { setFolded(v); void chrome.storage.local.set({ [FOLD_KEY]: v }).catch(() => undefined); };
  useEffect(() => { if (jobId) setFolded(false); }, [jobId]);
  return [folded, set];
}

/** 평가점수 가져오기 버튼. 진행 중에는 돌아가는 표시, 실패 문구는 알약 아래에 보인다. */
function EvalButton({ ctl, busy, onError }: { ctl: PanelController; busy: boolean; onError: (m: string | null) => void }) {
  const run = async () => {
    onError(null);
    const r = await ctl.collectEval();
    if (!r.ok) onError(r.message);
  };
  return (
    <button
      type="button" disabled={busy} onClick={() => void run()} title="개찰이 끝난 협상 공고의 평가점수를 가져와 분석합니다"
      className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <BarChart3 className="size-3.5" />}
      {busy ? '가져오는 중' : '평가점수 가져오기'}
    </button>
  );
}

const Mascot = ({ size }: { size: number }) => <img src={mascotUrl} alt="" width={size} height={size} className="shrink-0 select-none" draggable={false} />;

function Btn({ tone = 'ghost', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ghost' | 'danger' | 'primary' }) {
  const t = tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700'
    : tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100';
  return <button type="button" {...rest} className={`inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${t} ${className}`} />;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="tm-in w-[320px] rounded-xl border border-slate-200 bg-surface p-3" style={{ boxShadow: CARD_SHADOW }}>
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
  const [folded, setFolded] = useFolded(st.job?.id);
  const view = panelView(st.job, st.lookup, { title: st.title, current: st.notice, compose: st.compose });
  const handoffKind = view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error' ? view.handoff?.kind : undefined;
  const [nudge, setNudge] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  useEffect(() => { setEvalError(null); }, [st.notice?.noticeNo, st.notice?.round]);
  // 접기를 누르면 알약이 마스코트 공 쪽으로 말려 들어가는 애니메이션이 끝난 뒤 접는다
  const [closing, setClosing] = useState(false);
  useEffect(() => { setClosing(false); }, [st.job?.id]);
  const fold = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setFolded(true);
    else setClosing(true);
  };
  const uncollected = view.kind === 'idle' && !view.collected;
  useEffect(() => {
    if (!uncollected) { setNudge(false); return; }
    setNudge(true);
    const t = setTimeout(() => setNudge(false), NUDGE_MS);
    return () => clearTimeout(t);
  }, [uncollected, st.notice?.noticeNo, st.notice?.round]);

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

  const note = st.startError ?? st.sidePanelError ?? evalError ?? (st.otherTab ? '이 공고가 다른 탭에서 수집 중입니다' : null);
  let body: ReactNode;
  if (view.kind === 'idle' && folded && !st.orphaned) {
    // 접힌 상태: 마스코트 공 하나 + 상태 배지. 수집 전이면 말풍선으로 수집을 권한다
    const c = view.collected;
    body = (
      <div key="folded" className="tm-pop flex items-center gap-2">
        {!c && (
          <button
            type="button" disabled={st.starting} onClick={() => void ctl.collect()}
            className={`relative rounded-full border border-slate-200 bg-surface px-3 py-1.5 text-[0.75rem] font-medium text-slate-700 transition-opacity hover:bg-slate-50 ${nudge ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            style={{ boxShadow: CARD_SHADOW, transitionDuration: '300ms' }}
          >
            {st.starting ? '수집 시작 중…' : '이 공고 수집할까요?'}
            {/* 말풍선 꼬리 */}
            <span className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rotate-45 border-r border-t border-slate-200 bg-surface" />
          </button>
        )}
        <button
          type="button" onClick={() => setFolded(false)} onMouseEnter={() => setNudge(true)} title="펼치기" aria-label="펼치기"
          className="group cursor-pointer relative grid size-12 place-items-center rounded-full border border-slate-200 bg-surface transition-transform hover:scale-105"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <Mascot size={38} />
          {/* 마우스를 올리면 펼침 방향 화살표를 보여 누르면 펼쳐진다는 것을 알린다 */}
          <span className="tm-hint absolute -bottom-1 -left-1 grid size-4 place-items-center rounded-full border border-slate-200 bg-surface text-slate-600">
            <ChevronLeft className="size-3" strokeWidth={3} />
          </span>
          <span
            className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full border-2 border-surface text-white"
            style={{ background: !c ? '#2563eb' : c.tone === 'ok' ? '#2f7a4f' : '#a1620a' }}
          >
            {!c ? <Download className="size-2.5" strokeWidth={3} /> : c.tone === 'ok' ? <Check className="size-2.5" strokeWidth={3.5} /> : <span className="text-[0.625rem] font-bold leading-none">!</span>}
          </span>
        </button>
      </div>
    );
  } else if (view.kind === 'idle') {
    const c = view.collected;
    const color = c?.tone === 'warn' ? 'var(--bm-warn)' : 'var(--bm-ok)';
    const Icon = c?.tone === 'warn' ? AlertTriangle : CheckCircle2;
    // 한 알약 안에 마스코트, 상태(누르면 사이드 패널), 다시 수집, 접기를 함께 둔다
    body = (
      <div
        key="idle" className={`${closing ? 'tm-fold' : 'tm-unfold'} flex h-12 items-center gap-1 rounded-full border border-slate-200 bg-surface pl-1.5 pr-2`} style={{ boxShadow: CARD_SHADOW }}
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) { setClosing(false); setFolded(true); } }}
      >
        <button
          type="button" onClick={fold} disabled={closing} title="접기" aria-label="접기"
          className="group cursor-pointer relative grid size-9 place-items-center rounded-full transition-transform hover:scale-110"
        >
          <Mascot size={36} />
          <span className="tm-hint absolute -bottom-0.5 -right-1 grid size-4 place-items-center rounded-full border border-slate-200 bg-surface text-slate-600">
            <ChevronRight className="size-3" strokeWidth={3} />
          </span>
        </button>
        {c ? (
          <>
            {/* 누르면 사이드 패널 요약이 열리고, 다시 누르면 닫힌다. 채운 버튼 모양으로 눌러야 하는 것임을 보인다 */}
            <button
              type="button" onClick={() => ctl.openSidePanel()} title="요약 보기 (다시 누르면 닫기)"
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-semibold shadow-[0_1px_2px_rgba(15,23,42,.08)] transition-[background-color,box-shadow,transform] hover:shadow-[0_2px_6px_rgba(15,23,42,.14)] hover:brightness-[.97] dark:hover:brightness-[1.15] active:scale-[.97]"
              style={{ color, background: c.tone === 'ok' ? 'var(--bm-ok-wash)' : 'var(--bm-warn-wash)', borderColor: c.tone === 'ok' ? 'var(--bm-ok-line)' : 'var(--bm-warn-line)' }}
            >
              <Icon className="size-4" />
              {c.text}
              {c.dday && <span className="font-bold text-orange-500">{c.dday}</span>}
            </button>
            <span className="h-5 w-px bg-slate-200" />
            <button
              type="button" disabled={st.starting} onClick={() => void ctl.collect()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
            >
              {st.starting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              다시 수집
            </button>
          </>
        ) : (
          <button
            type="button" disabled={st.starting} onClick={() => void ctl.collect()}
            className="ml-1 inline-flex h-9 items-center gap-2 rounded-full bg-blue-600 px-4 text-[0.8125rem] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {st.starting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {view.buttonLabel}
          </button>
        )}
        <span className="h-5 w-px bg-slate-200" />
        <EvalButton ctl={ctl} busy={st.evalBusy} onError={setEvalError} />
      </div>
    );
        if (st.orphaned) {
      body = <div className="flex flex-col items-end gap-2">
        <div className="max-w-[320px] rounded-lg border border-amber-200 bg-surface px-3 py-2 text-xs text-amber-600" style={{ boxShadow: CARD_SHADOW }}>확장이 업데이트되었습니다. 페이지를 새로고침하세요</div>
      </div>;
    } else if (note) {
      body = <div className="flex flex-col items-end gap-2">
        <div className="max-w-[320px] rounded-lg border border-red-200 bg-surface px-3 py-2 text-xs text-red-600" style={{ boxShadow: CARD_SHADOW }}>{note}</div>
        {body}
      </div>;
    }
  } else if (view.kind === 'progress') {
    body = minimized ? (
      <button
        key="pill" type="button" onClick={() => setMinimized(false)}
        className="tm-in inline-flex h-10 items-center gap-2 rounded-full bg-blue-600 px-4 text-[0.8125rem] font-medium text-white"
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
        <div className="mt-1 wrap-anywhere text-xs text-slate-500">{view.label}</div>
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
            {view.detail && <div className="mt-0.5 wrap-anywhere text-xs text-slate-500">{view.detail}</div>}
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
          <div className="max-w-[320px] rounded-lg border border-amber-200 bg-surface px-3 py-2 text-xs text-amber-600" style={{ boxShadow: CARD_SHADOW }}>{note}</div>
        )}
        {body}
      </div>
    </div>
  );
}
