import { Download } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { evalErrorText } from '../../../core/evaluation/error-text';
import { EVAL_COLLECT_UI_TIMEOUT_MS } from '../../../core/evaluation/limits';
import { send } from '../../../messaging/bus';
import { Button } from '../../../ui/components';
import { Mascot, type MascotMood } from '../../../ui/mascot';
import { autoEvalTargets, type EvalAutoAttempts, type EvalBatchItem, type EvalBatchState, runEvalBatch } from '../../../ui/notices/eval-fetch-view';

// 평가분석 진입 시 우리 회사 참여 공고의 평가점수를 묻고 가져오는 흐름. 화면을 옮겨도 이어지도록 대시보드 전역 상태로 둔다
type Phase =
  | { kind: 'idle' }
  | { kind: 'ask'; items: EvalBatchItem[]; titles: Map<string, string> }
  | { kind: 'run'; state: EvalBatchState; titles: Map<string, string> };

let phase: Phase = { kind: 'idle' };
/** 이번 대시보드 창에서 [나중에]를 눌렀으면 다시 묻지 않는다 */
let declined = false;
let cancel = false;
const listeners = new Set<() => void>();
const set = (p: Phase) => { phase = p; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function useEvalAuto(): Phase {
  return useSyncExternalStore(subscribe, () => phase);
}

const AUTO_KEY = 'evalAutoAttempts';
function readAttempts(): EvalAutoAttempts {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(AUTO_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as EvalAutoAttempts) : {};
  } catch { return {}; }
}
function writeAttempts(a: EvalAutoAttempts): void {
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(a)); } catch { /* 기록 못 하면 다음에 다시 물을 뿐 */ }
}

const busy = () => phase.kind === 'ask' || (phase.kind === 'run' && phase.state.running);

/** 가져올 공고가 있으면 오른쪽 아래에서 물어본다. have는 이미 가져온 평가의 noticeId */
export async function offerEvalAuto(have: ReadonlySet<string>): Promise<void> {
  if (declined || busy()) return;
  const notices = await send('notice/list', undefined).catch(() => null);
  if (!notices || declined || busy()) return;
  const items = autoEvalTargets(notices, have, readAttempts(), new Date());
  if (items.length === 0) return;
  set({ kind: 'ask', items, titles: new Map(notices.map((n) => [n.noticeId, n.title])) });
}

export function declineEvalAuto(): void {
  declined = true;
  set({ kind: 'idle' });
}

export async function startEvalAuto(): Promise<void> {
  if (phase.kind !== 'ask') return;
  const { items, titles } = phase;
  cancel = false;
  const attempts = readAttempts();
  const idOf = new Map(items.map((it) => [`${it.noticeNo}-${it.round}`, it.noticeId]));
  await runEvalBatch(items, {
    collect: async (ref) => {
      const id = idOf.get(`${ref.noticeNo}-${ref.round}`) ?? '';
      try {
        const r = await send('eval/collect', { ref }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS });
        delete attempts[id];
        writeAttempts(attempts);
        return r;
      } catch (e) {
        const code = (e as { code?: string }).code;
        attempts[id] = { at: Date.now(), ...(code ? { code } : {}) };
        writeAttempts(attempts);
        throw e;
      }
    },
    errorText: (code, message) => (code === 'INTERNAL' ? message : evalErrorText(code, message)),
    onUpdate: (state) => set({ kind: 'run', state, titles }),
    cancelled: () => cancel,
  });
}

const DOCK_CSS = `
@keyframes bm-dock-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
.bm-dock { animation: bm-dock-in 260ms cubic-bezier(.2,.8,.3,1) both; }
@media (prefers-reduced-motion: reduce) { .bm-dock { animation: none; } }
`;

/** 마스코트 얼굴 동그라미. 진행 중에는 테두리를 파랗게 */
function Avatar({ mood, active }: { mood: MascotMood; active?: boolean }) {
  return (
    <div className={`grid size-14 shrink-0 place-items-center rounded-full ${active ? 'bg-primary/10 ring-2 ring-primary/30' : 'bg-sunken'}`}>
      <Mascot key={mood} mood={mood} variant="face" size={46} hops={mood === 'run' ? undefined : 2} />
    </div>
  );
}

/** 오른쪽 아래 카드. 묻기 → 진행 → 결과 */
export function EvalAutoDock({ onEvaluations }: { onEvaluations: boolean }) {
  const p = useEvalAuto();
  if (p.kind === 'idle') return null;
  const titleOf = (id: string) => p.titles.get(id) ?? id;
  return (
    <div role="status" className="bm-dock fixed right-6 bottom-6 z-40 w-[25rem] max-w-[calc(100vw-3rem)] rounded-card border border-line bg-surface p-4 text-ink shadow-raised tabular-nums">
      <style>{DOCK_CSS}</style>
      {p.kind === 'ask' ? (
        <>
          <div className="flex items-center gap-3.5">
            <Avatar mood="guide" />
            <div className="min-w-0">
              <div className="text-[0.9375rem] font-bold">평가분석 {p.items.length}건, 가져올까요?</div>
              <div className="mt-0.5 text-[0.8125rem] leading-snug text-muted">우리 회사가 참여한 공고의 평가 결과가 나왔어요</div>
            </div>
          </div>
          <ul className="mt-3 space-y-1 rounded-ctl bg-sunken px-3 py-2.5 text-[0.8125rem]">
            {p.items.slice(0, 3).map((it) => (
              <li key={it.noticeId} className="flex min-w-0 items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-primary/60" /><span className="truncate">{titleOf(it.noticeId)}</span></li>
            ))}
            {p.items.length > 3 && <li className="pl-3.5 text-muted">외 {p.items.length - 3}건</li>}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" className="!h-9 !px-3" onClick={declineEvalAuto}>나중에</Button>
            <Button variant="primary" className="!h-9 !px-3.5" icon={<Download />} onClick={() => void startEvalAuto()}>가져오기</Button>
          </div>
        </>
      ) : (
        <RunBody s={p.state} titleOf={titleOf} onEvaluations={onEvaluations} />
      )}
    </div>
  );
}

function RunBody({ s, titleOf, onEvaluations }: { s: EvalBatchState; titleOf: (id: string) => string; onEvaluations: boolean }) {
  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  const trouble = !!s.stopped || (s.failed.length > 0 && s.ok === 0);
  const mood: MascotMood = s.running ? 'run' : trouble ? 'huh' : 'happy';
  return (
    <>
      <div className="flex items-center gap-3.5">
        <Avatar mood={mood} active={s.running} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[0.9375rem] font-bold">
              {s.running ? '평가분석 가져오는 중' : s.ok > 0 ? `평가분석 ${s.ok}건 가져왔어요` : '평가분석을 가져오지 못했어요'}
            </span>
            {s.running && <span className="font-mono text-[0.8125rem] font-semibold text-primary">{s.done}/{s.total}</span>}
          </div>
          {s.running && s.current && <div className="mt-0.5 truncate text-[0.8125rem] text-muted">{titleOf(s.current)}</div>}
          {!s.running && s.failed.length > 0 && <div className="mt-0.5 text-[0.8125rem] text-muted">{s.failed.length}건은 아직 가져올 수 없어요</div>}
        </div>
        {s.running
          ? <Button variant="ghost" className="!h-8 shrink-0 !px-2.5" onClick={() => { cancel = true; }}>중단</Button>
          : <Button variant="ghost" className="!h-8 shrink-0 !px-2.5" onClick={() => set({ kind: 'idle' })}>닫기</Button>}
      </div>
      {s.running && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
      )}
      {s.stopped && <div className="mt-2 text-[0.8125rem] text-danger">{s.stopped === '중단됨' ? '중단했습니다. 남은 공고는 가져오지 않았습니다' : `남은 공고를 멈췄습니다: ${s.stopped}`}</div>}
      {!s.running && s.failed.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-ctl bg-sunken px-3 py-2.5 text-[0.8125rem] text-muted">
          {s.failed.map((f) => <li key={f.noticeId} className="break-words"><span className="text-ink">{titleOf(f.noticeId)}</span>: {f.message}</li>)}
        </ul>
      )}
      {!s.running && s.ok > 0 && !onEvaluations && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" className="!h-8 !px-2.5" onClick={() => { location.hash = '#/evaluations'; }}>평가분석 보기</Button>
        </div>
      )}
    </>
  );
}
