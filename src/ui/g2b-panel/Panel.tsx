import { AlertTriangle, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, FileText, Loader2, Mail, PanelRightOpen, RotateCw, X, XCircle } from 'lucide-react';
import mascotUrl from '../trackerbot/assets/bidmate-mascot.png?inline';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PanelController } from './controller';
import type { HandoffView } from '../handoff-view';
import { checkRootPath, joinRootPath, ROOT_PATH_KEY, ROOT_PATH_SKIP_KEY, type StoredRootPath } from '../../core/model/root-path';
import { send } from '../../messaging/bus';
import { panelView, type PanelView } from './panel-view';
import { createProgressCard, PROGRESS_TRANSIT_MS, type ProgressCardCallbacks } from '../progress-card/card';
import type { ProgressPanelView } from '../progress-card/types';
import { collectProgressView, evalProgressView, settledProgressView } from './progress-card-view';

const CARD_SHADOW = 'var(--bm-card-shadow)';
const AUTO_COLLAPSE_MS = 6000;
const FOREIGN_DONE_MS = 3000;
const BUBBLE_SHOW_MS = 6500;
const BUBBLE_FADE_MS = 300;

/** 대기 알약 접기 상태. 페이지에 들어오면 접혀 있고, 이 페이지에서 새 잡이 시작되면 펼친다 */
function useFolded(job: { id: string; createdAt: string } | null | undefined): [boolean, (v: boolean) => void] {
  // 페이지에 들어오면 수집 여부와 관계없이 접혀 있다. 이 페이지에서 새로 시작한 잡만 펼친다(지난 잡이 남아 있어도 펼치지 않음)
  const [folded, setFolded] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const fresh = !!job && Date.parse(job.createdAt) >= mountedAt - 1000;
  useEffect(() => { if (fresh) setFolded(false); }, [fresh, job?.id]);
  return [folded, setFolded];
}

/** 평가점수 가져오기 버튼. 진행 중에는 돌아가는 표시, 실패 문구는 알약 아래에 보인다. */
function EvalButton({ ctl, busy, onError }: { ctl: PanelController; busy: boolean; onError: (m: string | null) => void }) {
  const run = async () => {
    onError(null);
    const r = await ctl.collectEval();
    if (!r.ok) onError(r.message);
  };
  return (
    <IconBtn label={busy ? '평가점수 가져오는 중' : '평가점수 가져오기'} disabled={busy} onClick={() => void run()}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
    </IconBtn>
  );
}

/** 대기 알약의 보조 버튼. 알약이 길어지지 않게 아이콘만 두고, 마우스를 올리면 위에 이름을 바로 띄운다 */
function IconBtn({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button" aria-label={label} {...rest}
      className="group relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-60"
    >
      {children}
      <span
        className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: '#0f172a', color: '#fff' }}
      >{label}</span>
    </button>
  );
}

const Mascot = ({ size }: { size: number }) => <img src={mascotUrl} alt="" width={size} height={size} className="shrink-0 select-none" draggable={false} />;

/** 대기 알약의 버튼과 같은 알약 모양. outline은 안쪽 박스 위에서 눌러야 하는 버튼임을 보인다 */
function Btn({ tone = 'ghost', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ghost' | 'outline' | 'danger' | 'primary' }) {
  const t = tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700'
    : tone === 'danger' ? 'text-red-600 hover:bg-red-50'
    : tone === 'outline' ? 'border border-slate-200 bg-surface text-slate-700 hover:bg-slate-100'
    : 'text-slate-600 hover:bg-slate-100';
  return <button type="button" {...rest} className={`inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-50 ${t} ${className}`} />;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="tm-in w-[340px] rounded-[20px] border border-slate-200 bg-surface p-3.5" style={{ boxShadow: CARD_SHADOW }}>
      {children}
    </div>
  );
}

/** 카드 안쪽 정보 묶음. 줄마다 구분선을 둔다 */
const Inset = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-xl bg-slate-50">{children}</div>
);
const Row = ({ children }: { children: ReactNode }) => <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-xs">{children}</div>;

const HANDOFF_TEXT: Record<HandoffView['tone'], string> = {
  ok: 'text-green-700', warn: 'text-amber-600', error: 'text-red-600', info: 'text-slate-600',
};

/** 자동 메일 작성/검수 처리 한 줄 + 버튼. Done은 Inset 줄로, 나머지는 구분선 아래 줄로 쓴다 */
function HandoffLine({ h, ctl, inset = false }: { h: HandoffView; ctl: PanelController; inset?: boolean }) {
  const content = (
    <>
      <div className={`min-w-0 flex-1 text-xs ${HANDOFF_TEXT[h.tone]}`} title={h.text}>{h.text}</div>
      {h.action !== 'none' && h.actionLabel && <Btn tone="outline" onClick={() => void ctl.handoffAction(h.action)}>{h.actionLabel}</Btn>}
    </>
  );
  return inset ? <Row>{content}</Row> : <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">{content}</div>;
}

const IS_MAC = /Mac/i.test(navigator.userAgent);

/**
 * 저장 경로 줄. 실제 경로를 알면 전체 경로를 복사하고, 모르면 처음 한 번만 물어본다.
 * 건너뛰면 다시 묻지 않고 폴더 안쪽 경로만 복사한다(대시보드 저장 폴더 카드에서 나중에 넣을 수 있다).
 */
function FolderRow({ folder, onAsking }: { folder: string; onAsking: (v: boolean) => void }) {
  const [info, setInfo] = useState<{ rootName?: string; stored?: StoredRootPath; skip: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'full' | 'rel' | null>(null);
  useEffect(() => {
    // 누르는 순간 바로 복사되도록 미리 읽어 둔다(클립보드는 클릭 직후에만 쓸 수 있다)
    void Promise.all([
      send('fs/status', undefined).then((s) => s.rootName, () => undefined),
      chrome.storage.local.get([ROOT_PATH_KEY, ROOT_PATH_SKIP_KEY]).catch(() => ({} as Record<string, unknown>)),
    ]).then(([rootName, r]) => setInfo({ rootName, stored: r[ROOT_PATH_KEY] as StoredRootPath | undefined, skip: r[ROOT_PATH_SKIP_KEY] === true }));
  }, []);
  const ask = (v: boolean) => { setAsking(v); onAsking(v); };
  const write = (text: string, kind: 'full' | 'rel') => void navigator.clipboard?.writeText(text).then(() => setCopied(kind)).catch(() => undefined);
  const rootName = info?.rootName;
  const full = rootName && info?.stored?.rootName === rootName ? joinRootPath(info.stored.path, folder) : null;
  const copy = () => {
    if (full) write(full, 'full');
    else if (rootName && !info?.skip) { setError(null); ask(true); }
    else write(folder, 'rel');
  };
  const save = () => {
    if (!rootName) return;
    const r = checkRootPath(input, rootName);
    if (!r.ok) { setError(r.reason); return; }
    const stored = { rootName, path: r.path };
    void chrome.storage.local.set({ [ROOT_PATH_KEY]: stored }).catch(() => undefined);
    setInfo({ ...info, rootName, stored, skip: false });
    ask(false);
    write(joinRootPath(r.path, folder), 'full');
  };
  const skip = () => {
    void chrome.storage.local.set({ [ROOT_PATH_SKIP_KEY]: true }).catch(() => undefined);
    setInfo({ ...info, skip: true });
    ask(false);
    write(folder, 'rel');
  };

  if (asking) {
    return (
      <div className="px-3 py-2.5 text-xs">
        <div className="font-medium text-slate-700">전체 경로로 복사하려면 저장 폴더 위치를 한 번만 알려 주세요</div>
        <div className="mt-0.5 text-slate-500">
          {IS_MAC ? `Finder에서 '${rootName}' 폴더를 ⌥ 누른 채 우클릭, '경로 이름 복사'` : `탐색기에서 '${rootName}' 폴더를 Shift 누른 채 우클릭, '경로로 복사'`}
        </div>
        <input
          autoFocus value={input} onChange={(e) => { setInput(e.target.value); setError(null); }}
          // 사이트의 단축키 처리로 새지 않게 막는다
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') ask(false); }}
          placeholder={IS_MAC ? `/Users/이름/Documents/${rootName}` : `C:\\Users\\이름\\Documents\\${rootName}`}
          className="mt-2 h-8 w-full rounded-lg border border-slate-200 bg-surface px-2.5 text-xs text-slate-700 outline-none placeholder:text-slate-500 focus:border-blue-600"
        />
        {error && <div className="mt-1 text-red-600">{error}</div>}
        <div className="mt-2 flex justify-end gap-1.5">
          <Btn onClick={skip}>건너뛰기</Btn>
          <Btn tone="primary" onClick={save}>저장하고 복사</Btn>
        </div>
      </div>
    );
  }
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-500" title={full ?? folder}>{folder}</div>
        {copied === 'full' && <div className="text-green-700">{IS_MAC ? 'Finder에서 ⌘⇧G 누르고 붙여 넣으면 바로 열립니다' : '탐색기 주소창에 붙여 넣으면 바로 열립니다'}</div>}
      </div>
      <Btn tone="outline" onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? '복사됨' : '경로 복사'}</Btn>
    </Row>
  );
}

function Done({ view, ctl, onAsking }: { view: Extract<PanelView, { kind: 'completed' | 'partial' }>; ctl: PanelController; onAsking: (v: boolean) => void }) {
  const ok = view.kind === 'completed';
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  // 수집 완료 안내(edit/ask)는 아래 [상세]/[메일 작성] 버튼과 겹쳐 줄을 숨긴다
  const handoff = view.handoff && view.handoff.kind !== 'edit' && view.handoff.kind !== 'ask' ? view.handoff : undefined;
  const hasInset = (view.kind === 'partial' && view.failures.length > 0) || !!view.extractionLine || !!view.folder || !!handoff;
  const retry = view.kind === 'partial' && view.canRetry;
  return (
    <>
      {/* 머리: 대기 알약과 같은 마스코트 + 상태 색 제목 */}
      <div className="flex items-center gap-2.5">
        <Mascot size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[14px] font-semibold leading-5" style={{ color: ok ? 'var(--bm-ok)' : 'var(--bm-warn)' }}>
            <Icon className="size-4 shrink-0" />{view.headline}
          </div>
          {view.title && <div className="truncate text-xs text-slate-500" title={view.title}>{view.title}</div>}
        </div>
        <Btn aria-label="닫기" className="size-7 !px-0" onClick={() => ctl.dismissJob()}><X className="size-4" /></Btn>
      </div>
      {hasInset && (
        <Inset>
          {view.kind === 'partial' && view.failures.map((f, i) => (
            <Row key={i}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={f.name}>{f.name}</div>
                <div className="truncate text-slate-500" title={f.reason}>{f.reason}</div>
              </div>
            </Row>
          ))}
          {view.kind === 'partial' && view.moreCount > 0 && <Row><span className="text-slate-500">외 {view.moreCount}건</span></Row>}
          {view.extractionLine && (
            <Row>
              <div className="min-w-0 flex-1 truncate text-slate-700">{view.extractionLine}</div>
              {view.reviewNoticeId && <Btn tone="outline" onClick={() => ctl.openUi('review', view.reviewNoticeId)}>검수</Btn>}
            </Row>
          )}
          {view.folder && <FolderRow folder={view.folder} onAsking={onAsking} />}
          {handoff && <HandoffLine h={handoff} ctl={ctl} inset />}
        </Inset>
      )}
      {/* 대시보드는 저절로 열지 않는다. 상세나 메일 작성을 눌러야 이동한다 */}
      {(view.noticeId || retry) && (
        <div className="mt-3 flex justify-end gap-1.5">
          {view.noticeId && <Btn tone="outline" className="h-8 px-3.5" onClick={() => ctl.openUi('notice', view.noticeId)}><FileText className="size-3.5" />상세</Btn>}
          {view.noticeId && <Btn tone={retry ? 'outline' : 'primary'} className="h-8 px-3.5" onClick={() => ctl.openUi('mail', view.noticeId)}><Mail className="size-3.5" />메일 작성</Btn>}
          {retry && <Btn tone="primary" className="h-8 px-4" onClick={() => void ctl.retry()}>{view.retryLabel}</Btn>}
        </div>
      )}
      {view.kind === 'partial' && !view.canRetry && <div className="mt-3 text-xs text-slate-500">해당 공고 화면에서 다시 시도하세요</div>}
    </>
  );
}

/** 트래커봇과 같은 진행 카드를 g2b 패널 흐름 안에 붙인다(inline). 카드는 한 번만 만들고 콜백은 ref로 최신화한다 */
function ProgressCardMount({ view, on }: { view: ProgressPanelView; on: Pick<ProgressCardCallbacks, 'cancel' | 'force' | 'toggleCollapse' | 'hover'> }) {
  const holder = useRef<HTMLDivElement>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const handle = useRef<ReturnType<typeof createProgressCard> | null>(null);
  useEffect(() => {
    const h = createProgressCard(document, {
      cancel: (k) => onRef.current.cancel(k),
      force: (k) => onRef.current.force?.(k),
      toggleCollapse: () => onRef.current.toggleCollapse(),
      hover: (o) => onRef.current.hover(o),
      dismiss: () => {}, dismissAll: () => {}, action: () => {},
    }, { inline: true });
    handle.current = h;
    holder.current?.append(h.host);
    return () => { h.dispose(); handle.current = null; };
  }, []);
  useEffect(() => { handle.current?.render(view); }, [view]);
  return <div ref={holder} />;
}

export function PanelApp({ controller: ctl }: { controller: PanelController }) {
  const st = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const [minimized, setMinimized] = useState(false);
  const [hover, setHover] = useState(false);
  const [settling, setSettling] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setAsking(false); }, [st.job?.id]);
  const [folded, setFolded] = useFolded(st.job);
  const view = panelView(st.job, st.lookup, { title: st.title, current: st.notice, compose: st.compose });
  // 진행 -> 완료 전환: 같은 잡이면 진행 카드를 잠깐 유지해 도착/실패 연출을 보인다(렌더 중 판정해야 카드가 다시 만들어지지 않는다)
  const jobId = st.job?.id;
  const [prevSeen, setPrevSeen] = useState({ kind: view.kind, jobId });
  if (prevSeen.kind !== view.kind || prevSeen.jobId !== jobId) {
    setPrevSeen({ kind: view.kind, jobId });
    if (prevSeen.jobId !== jobId) setSettling(false);
    else if (prevSeen.kind === 'progress' && (view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error') && !minimized) setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => setSettling(false), PROGRESS_TRANSIT_MS);
    return () => clearTimeout(t);
  }, [settling, jobId]);
  const settlingView = settling && (view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error');
  const viewKey = view.kind === 'progress' ? `${view.pillText}${view.title}${view.foreignLabel}`
    : view.kind === 'completed' || view.kind === 'partial' ? view.headline : view.kind === 'error' ? view.message : '';
  const cardView = useMemo<ProgressPanelView | null>(() => {
    if (!st.job) return null;
    if (view.kind === 'progress') return collectProgressView(st.job, view, minimized);
    if (settlingView && (view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error')) return settledProgressView(st.job, view);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.job, minimized, settlingView, view.kind, viewKey]);
  const cardOn = {
    cancel: () => void ctl.cancel(false),
    force: () => void ctl.cancel(true),
    toggleCollapse: () => setMinimized((m) => !m),
    hover: () => {}, // hover는 바깥 래퍼의 onMouseEnter/Leave가 맡는다(카드→note 이동 시 꺼지지 않게)
  };
  // 평가점수 가져오기도 수집과 같은 진행 카드로 보인다. 끝나면 도착/실패 연출 뒤 대기 알약으로 돌아간다
  const evalRun = st.evalRun;
  const evalCardView = useMemo(() => (evalRun ? evalProgressView(evalRun, minimized) : null), [evalRun, minimized]);
  useEffect(() => {
    if (!evalRun || evalRun.state === 'active') return;
    const t = setTimeout(() => ctl.clearEvalRun(evalRun.key), PROGRESS_TRANSIT_MS);
    return () => clearTimeout(t);
  }, [evalRun, ctl]);
  const handoffKind = view.kind === 'completed' || view.kind === 'partial' || view.kind === 'error' ? view.handoff?.kind : undefined;
  const [evalError, setEvalError] = useState<string | null>(null);
  useEffect(() => { setEvalError(null); }, [st.notice?.noticeNo, st.notice?.round]);
  // 접힌 상태 말풍선은 공고마다, 그리고 말풍선 내용(수집 전→수집 상태)이 바뀔 때 잠깐 보였다가 흐려지며 사라진다
  const [bubble, setBubble] = useState<'show' | 'fading' | 'hidden'>('show');
  const bubbleText = view.kind === 'idle' ? view.collected?.text ?? '' : '';
  useEffect(() => {
    setBubble('show');
    const t1 = setTimeout(() => setBubble('fading'), BUBBLE_SHOW_MS);
    const t2 = setTimeout(() => setBubble('hidden'), BUBBLE_SHOW_MS + BUBBLE_FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [st.notice?.noticeNo, st.notice?.round, bubbleText]);
  // 접기를 누르면 알약이 마스코트 공 쪽으로 말려 들어가는 애니메이션이 끝난 뒤 접는다
  const [closing, setClosing] = useState(false);
  useEffect(() => { setClosing(false); }, [st.job?.id]);
  const fold = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setFolded(true);
    else setClosing(true);
  };

  // 완료 6초 뒤 자동 축소(마우스가 위에 있으면 정지). partial/error는 축소하지 않는다.
  useEffect(() => {
    // 다른 공고의 잡은 종료 알림을 3초만 보여 주고 현재 공고의 대기 pill로 돌아간다.
    if (settling) return;
    const foreignDone = view.kind !== 'idle' && view.kind !== 'progress' && view.foreign;
    if (!foreignDone && view.kind !== 'completed') return;
    // 마우스가 위에 있거나 경로를 입력받는 중이면 접지 않는다
    if ((hover || asking) && !foreignDone) return;
    // 자동 메일 작성이 대기/진행 중이면 접지 않고, 종결된 뒤에 적용한다.
    if (!foreignDone && (handoffKind === 'queued' || handoffKind === 'composing')) return;
    const t = setTimeout(() => ctl.dismissJob(), foreignDone ? FOREIGN_DONE_MS : AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [view.kind, hover, asking, ctl, st.job?.id, handoffKind, settling]);

  // 새 잡이 시작되면 최소화를 풀어 준다.
  useEffect(() => { setMinimized(false); }, [st.job?.id]);

  const visible = st.notice !== null || view.kind === 'progress' || st.orphaned;
  if (!visible) return null;

  const note = st.startError ?? st.sidePanelError ?? evalError ?? (st.otherTab ? '이 공고가 다른 탭에서 수집 중입니다' : null);
  let body: ReactNode;
  if (view.kind === 'idle' && evalCardView && !st.orphaned) {
    body = <ProgressCardMount key="eval-card" view={evalCardView} on={{ ...cardOn, cancel: () => {}, force: () => {} }} />;
  } else if (view.kind === 'idle' && folded && !st.orphaned) {
    // 접힌 상태: 마스코트 공 하나 + 상태 배지 + 말풍선. 말풍선은 처음에 잠깐만 떠 있다
    // 수집 전이면 수집을 권하고(누르면 펼침 — 수집은 펼친 뒤 버튼으로만), 수집한 공고면 상태를 말한다(누르면 사이드 패널 요약)
    const c = view.collected;
    body = (
      <div key="folded" className="tm-pop flex items-center gap-2">
        {bubble !== 'hidden' && <button
          type="button"
          onClick={() => { if (c) ctl.openSidePanel(); else setFolded(false); }}
          title={c ? '요약 보기 (다시 누르면 닫기)' : '펼치기'}
          className={`relative inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-surface px-3 py-1.5 text-[12px] font-medium text-slate-700 transition-[opacity,background-color] hover:bg-slate-50 ${bubble === 'fading' ? 'pointer-events-none opacity-0' : ''}`}
          style={{ boxShadow: CARD_SHADOW, transitionDuration: `${BUBBLE_FADE_MS}ms` }}
        >
          {c ? (
            <>
              <span className="font-semibold" style={{ color: c.tone === 'ok' ? 'var(--bm-ok)' : 'var(--bm-warn)' }}>{c.text}</span>
              {c.dday && <span className="font-bold text-orange-500">{c.dday}</span>}
            </>
          ) : st.starting ? '수집 시작 중…' : '이 공고 수집할까요?'}
          {/* 말풍선 꼬리 */}
          <span className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rotate-45 border-r border-t border-slate-200 bg-surface" />
        </button>}
        <button
          type="button" onClick={() => setFolded(false)} title="펼치기" aria-label="펼치기"
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
            {!c ? <Download className="size-2.5" strokeWidth={3} /> : c.tone === 'ok' ? <Check className="size-2.5" strokeWidth={3.5} /> : <span className="text-[10px] font-bold leading-none">!</span>}
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
              className="group inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border pl-3 pr-2 text-[13px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,.08)] transition-[background-color,box-shadow,transform] hover:shadow-[0_2px_6px_rgba(15,23,42,.14)] hover:brightness-[.97] dark:hover:brightness-[1.15] active:scale-[.97]"
              style={{ color, background: c.tone === 'ok' ? 'var(--bm-ok-wash)' : 'var(--bm-warn-wash)', borderColor: c.tone === 'ok' ? 'var(--bm-ok-line)' : 'var(--bm-warn-line)' }}
            >
              <Icon className="size-4" />
              {c.text}
              {c.dday && <span className="font-bold text-orange-500">{c.dday}</span>}
              {/* 누르면 사이드 패널이 열린다는 표시. 칸을 나눠 상태 글자와 구분한다 */}
              <span className="ml-0.5 grid size-6 place-items-center rounded-full border-l pl-1.5 opacity-80 transition-opacity group-hover:opacity-100" style={{ borderColor: 'currentColor' }}>
                <PanelRightOpen className="size-4" />
              </span>
            </button>
            {st.lookup.noticeId && (
              <>
                <span className="h-5 w-px bg-slate-200" />
                {/* 수집한 공고는 여기서 대시보드 메일 준비 화면이나 공고 상세로 간다 */}
                <button
                  type="button" onClick={() => ctl.openUi('mail', st.lookup.noticeId)} title="대시보드에서 이 공고의 메일을 작성해 발송합니다"
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <Mail className="size-3.5" />
                  메일 작성
                </button>
              </>
            )}
            <span className="h-5 w-px bg-slate-200" />
            {st.lookup.noticeId && (
              <IconBtn label="대시보드에서 상세 보기" onClick={() => ctl.openUi('notice', st.lookup.noticeId)}>
                <FileText className="size-4" />
              </IconBtn>
            )}
            <IconBtn label="다시 수집" disabled={st.starting} onClick={() => void ctl.collect()}>
              {st.starting ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            </IconBtn>
          </>
        ) : (
          <button
            type="button" disabled={st.starting} onClick={() => void ctl.collect()}
            className="ml-1 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-blue-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-default disabled:opacity-60"
          >
            {st.starting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {view.buttonLabel}
          </button>
        )}
        {!c && <span className="h-5 w-px bg-slate-200" />}
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
    body = cardView && <ProgressCardMount key="progress-card" view={cardView} on={cardOn} />;
  } else if (settlingView && cardView) {
    // 진행 분기와 같은 key·같은 자리여야 카드 인스턴스가 유지돼 arrive/fail 연출이 재생된다
    body = <ProgressCardMount key="progress-card" view={cardView} on={cardOn} />;
  } else if (view.kind === 'completed' || view.kind === 'partial') {
    body = <Card key={view.kind}><Done view={view} ctl={ctl} onAsking={setAsking} /></Card>;
  } else {
    body = (
      <Card key="error">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{view.message}</div>
            {view.detail && <div className="mt-0.5 wrap-anywhere text-xs text-slate-500">{view.detail}</div>}
          </div>
          <Btn aria-label="닫기" className="size-7 !px-0" onClick={() => ctl.dismissJob()}><X className="size-4" /></Btn>
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
