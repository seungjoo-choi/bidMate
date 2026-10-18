import { Camera, Search, ChevronDown, ChevronRight, Circle, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isWebmailUrl } from '../../background/site-registry';
import { Button, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { callProbe, downloadJson, injectProbe, stamp, withSameOrigin } from './probe-runner';
import type { TabInfo } from './useActiveTab';

const SCENARIO = [
  '메일쓰기 열기',
  '받는사람 1명 입력/확정',
  '참조 열기 → 1명 입력',
  '제목 입력',
  '본문 한 줄 입력',
  '작은 파일 1개 첨부 → 업로드 완료 대기',
  '(선택) 임시저장',
  '녹화 정지/저장',
];

const SEL_R1 = ['input[name="subjectbox"]', 'div[aria-label="메일 본문"]', 'input[type="file"][name="Filedata"]', '[command="Files"]', 'h2', '[role="dialog"]', '[email]', '[data-hovercard-id]', '[role="listbox"]', '[role="option"]'];
const SEL_R2 = ['.dL', '[role="progressbar"]', '[aria-label="첨부파일 삭제"]', 'input[type="file"][name="Filedata"]'];
const SEL_R4 = ['[role="alertdialog"]', '[role="dialog"]'];

/** inspect/watch 셀렉터 프리셋. watch가 있으면 감시 입력란도 함께 채운다. */
const PRESETS: Array<{ label: string; inspect: string[]; watch?: string[] }> = [
  { label: 'R1 화면 구조', inspect: SEL_R1 },
  { label: 'R2 첨부 업로드', inspect: SEL_R2, watch: SEL_R2 },
  { label: 'R4 대화상자', inspect: SEL_R4 },
];

/** 줄바꿈으로 구분한 입력을 셀렉터 배열로 바꾼다. */
const parseSelectors = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** 개발자 진단(DOM 스냅샷/녹화). 기본은 접혀 있고, 녹화 중이면 접혀 있어도 머리줄에 표시한다. */
export function DiagnosticsSection({ tab }: { tab: TabInfo | null }) {
  const [expanded, setExpanded] = useState(false);
  const [hasPerm, setHasPerm] = useState<boolean | null>(null);
  const [isMail, setIsMail] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [busy, setBusy] = useState<'snap' | 'start' | 'stop' | 'inspect' | null>(null);
  const [inspectText, setInspectText] = useState('');
  const [watchText, setWatchText] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [open, setOpen] = useState(true);
  const startedRef = useRef(0);
  // 녹화를 시작한 탭. 활성 탭이 바뀌어도 폴링/정지는 이 탭으로만 호출한다.
  const recTabRef = useRef<TabInfo | null>(null);
  const [recTab, setRecTab] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!tab || !tab.url.startsWith('https:')) { setHasPerm(null); setIsMail(false); return; }
      const mail = await isWebmailUrl(tab.url);
      let perm = false;
      try { perm = await chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] }); } catch { /* false */ }
      if (alive) { setIsMail(mail); setHasPerm(perm); }
    })();
    return () => { alive = false; };
  }, [tab]);

  // 녹화 중 경과 시간/이벤트 수 표시
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(async () => {
      const rt = recTabRef.current;
      if (!rt) return;
      setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
      try {
        const frames = await callProbe(rt.id, 'status');
        setEventCount(frames.reduce((n, f) => n + (Number(f.events) || 0) + (Number(f.mutations) || 0), 0));
      } catch { /* 무시 */ }
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // 녹화 탭이 닫히면 녹화 상태를 해제한다.
  useEffect(() => {
    const onRemoved = (id: number) => {
      if (recTabRef.current?.id !== id) return;
      recTabRef.current = null;
      setRecTab(null);
      setRecording(false);
      setMsg({ tone: 'error', text: '녹화 중이던 탭이 닫혀 녹화가 중단되었습니다. 기록은 저장되지 않았습니다.' });
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }, []);

  const run = async (kind: 'snap' | 'start' | 'stop' | 'inspect') => {
    const target = kind === 'stop' ? recTabRef.current : tab;
    if (!target) return;
    setBusy(kind);
    setMsg(null);
    try {
      const meta = { url: target.url, host: target.host, ts: new Date().toISOString() };
      if (kind !== 'stop') await injectProbe(target.id);
      if (kind === 'snap') {
        const frames = withSameOrigin(await callProbe(target.id, 'snapshot'));
        await downloadJson(`bidmate-probe-${target.host}-${stamp()}.json`, { frames, meta: { ...meta, kind: 'snapshot' } });
        setMsg({ tone: 'ok', text: `스냅샷 저장 완료 (프레임 ${frames.length}개)` });
      } else if (kind === 'inspect') {
        const selectors = parseSelectors(inspectText);
        if (selectors.length === 0) {
          setMsg({ tone: 'error', text: '셀렉터를 한 줄에 하나씩 입력하세요.' });
          return;
        }
        const frames = withSameOrigin(await callProbe(target.id, 'inspect', [selectors]));
        await downloadJson(`bidmate-probe-${target.host}-${stamp()}.json`, { frames, meta: { ...meta, kind: 'inspect' } });
        setMsg({ tone: 'ok', text: `inspect 저장 완료 (프레임 ${frames.length}개)` });
      } else if (kind === 'start') {
        const watchSelectors = parseSelectors(watchText);
        await callProbe(target.id, 'startRecording', watchSelectors.length > 0 ? [{ watch: { selectors: watchSelectors } }] : []);
        // 시작 성공 직후 상태를 먼저 확정한다. 제목 조회 실패는 무시한다.
        recTabRef.current = target;
        startedRef.current = Date.now();
        setElapsed(0);
        setEventCount(0);
        setRecording(true);
        setRecTab({ id: target.id, title: target.host });
        chrome.tabs.get(target.id).then(
          (t) => setRecTab({ id: target.id, title: t.title || target.host }),
          () => undefined,
        );
        setMsg({ tone: 'info', text: '녹화 중입니다. 시나리오를 진행하세요. 보내기 버튼은 누르지 마세요.' });
      } else {
        const snapshots = await callProbe(target.id, 'snapshot');
        const frames = await callProbe(target.id, 'stopRecording');
        recTabRef.current = null;
        setRecTab(null);
        setRecording(false);
        if (frames.length === 0 || frames.every((f) => 'error' in f)) {
          setMsg({ tone: 'error', text: '녹화 탭이 새로고침되어 녹화 데이터가 사라졌습니다. 다시 녹화하세요.' });
          return;
        }
        const merged = withSameOrigin(frames.map((f) => ({ ...f, snapshot: snapshots.find((x) => x.frameId === f.frameId) })));
        await downloadJson(`bidmate-probe-${target.host}-${stamp()}.json`, {
          frames: merged,
          meta: { ...meta, kind: 'recording', durationMs: Date.now() - startedRef.current },
        });
        setMsg({ tone: 'ok', text: `녹화 저장 완료 (프레임 ${frames.length}개). 파일을 docs/probe/에 넣어 주세요.` });
      }
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const isHttps = !!tab?.url.startsWith('https:');
  const canDiag = isHttps && hasPerm === true;

  // 사용자 제스처 안에서 첫 await로 request를 호출한다.
  const grantSite = async () => {
    if (!tab) return;
    try {
      const ok = await chrome.permissions.request({ origins: [`${new URL(tab.url).origin}/*`] });
      setHasPerm(ok);
      if (!ok) setMsg({ tone: 'error', text: '권한이 허용되지 않았습니다.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const openSettings = () => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/settings') });

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex w-full items-center gap-1.5 text-left text-sm font-semibold text-muted hover:text-ink">
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        개발자 진단
        {recording && <span className="ml-auto font-mono text-xs text-danger tabular-nums">녹화 중 {mmss}</span>}
      </button>

      {expanded && (
        <div className="mt-4 space-y-5">
          <div className="space-y-2">
            {tab ? (
              <div className="min-w-0">
                <div className="truncate font-semibold">{tab.host || tab.url}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted" title={tab.url}>{tab.url}</div>
              </div>
            ) : (
              <div className="text-muted">활성 탭 없음</div>
            )}
            {tab && !isHttps && <StatusBadge status="error">이 페이지는 진단할 수 없습니다</StatusBadge>}
            {tab && isHttps && hasPerm === true && <StatusBadge status="ok">이 사이트 접근 허용됨</StatusBadge>}
            {tab && isHttps && hasPerm === false && (
              <div className="space-y-2">
                <StatusBadge status="warn">이 사이트 접근 권한 없음</StatusBadge>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button onClick={grantSite}>이 사이트 진단 허용</Button>
                  {isMail && (
                    <Button variant="ghost" onClick={openSettings}>대시보드 설정에서 허용</Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3.5">
            {recording && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-3 rounded-ctl bg-danger-wash px-4 py-3 text-danger">
                  <span aria-hidden className="size-2 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
                  <b className="text-base">녹화 중</b>
                  <span className="ml-auto font-mono text-2xl font-bold text-ink tabular-nums">{mmss}</span>
                </div>
                <div className="text-sm text-muted">기록된 이벤트 <span className="font-mono text-ink tabular-nums">{eventCount}</span>건</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={<Camera />} loading={busy === 'snap'} disabled={!canDiag || recording || !!busy} onClick={() => run('snap')}>
                스냅샷
              </Button>
              {recording ? (
                <Button icon={<Square />} loading={busy === 'stop'} disabled={!!busy} onClick={() => run('stop')}>
                  정지 후 저장
                </Button>
              ) : (
                <Button icon={<Circle />} loading={busy === 'start'} disabled={!canDiag || !!busy} onClick={() => run('start')}>
                  녹화 시작
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button key={p.label} variant="ghost" disabled={!!busy} onClick={() => { setInspectText(p.inspect.join('\n')); if (p.watch) setWatchText(p.watch.join('\n')); }}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-muted">inspect 셀렉터 (한 줄에 하나)</span>
                <textarea rows={4} className={`${inputClass} font-mono text-xs`} value={inspectText} onChange={(e) => setInspectText(e.target.value)} />
              </label>
              <Button variant="secondary" icon={<Search />} loading={busy === 'inspect'} disabled={!canDiag || recording || !!busy} onClick={() => run('inspect')}>
                inspect 실행
              </Button>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-muted">녹화 시 watch 셀렉터 (한 줄에 하나, 비우면 감시 안 함)</span>
                <textarea rows={3} className={`${inputClass} font-mono text-xs`} value={watchText} disabled={recording} onChange={(e) => setWatchText(e.target.value)} />
              </label>
            </div>
            {recording && recTab && tab?.id !== recTab.id && (
              <InlineAlert tone="warn">
                <div className="truncate">녹화 중인 탭: {recTab.title}</div>
                <Button variant="secondary" className="mt-2" onClick={() => void chrome.tabs.update(recTab.id, { active: true })}>
                  녹화 탭으로 이동
                </Button>
              </InlineAlert>
            )}
            {msg && <InlineAlert tone={msg.tone}>{msg.text}</InlineAlert>}
            {!isMail && (
              <p className="text-sm text-muted">
                페이지가 완전히 로드된 뒤 [스냅샷]을 누르세요. 첨부파일 목록이 접혀 있으면 펼친 뒤 다시 찍으세요.
              </p>
            )}
          </div>

          {isMail && (
            <div>
              <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-sm font-semibold text-muted hover:text-ink">
                {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                녹화 시나리오
              </button>
              {open && (
                <div className="mt-3 space-y-3">
                  <p className="font-semibold text-danger">보내기 버튼은 누르지 마세요</p>
                  <ol className="space-y-2">
                    {SCENARIO.map((s, i) => (
                      <li key={s} className="flex gap-2.5">
                        <span className="w-4 shrink-0 text-right font-mono text-sm leading-6 text-faint">{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
