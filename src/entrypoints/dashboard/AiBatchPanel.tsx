import { useEffect, useState } from 'react';
import type { AiBatchState } from '../../core/types/ai';
import { PROVIDERS } from '../../engine/ai/providers';
import { Button, InlineAlert, ProviderIcon } from '../../ui/components';
import {
  barCells, batchActive, batchCounts, currentNoticeId, finishText, itemResult, progressIndex, retryTargets, stopReasonText, waitSeconds,
  type BarCell, type ResultTone,
} from '../../ui/review/ai-batch-view';
import { noticeHash } from './route';

const CELL: Record<BarCell, string> = {
  done: 'bg-ok', fail: 'bg-danger', skip: 'bg-faint', run: 'bg-ai-ink animate-pulse motion-reduce:animate-none', queued: 'bg-line',
};
const TONE: Record<ResultTone, string> = { ok: 'text-ok', muted: 'text-muted', bad: 'text-danger' };
const LEGEND: Array<[BarCell, string]> = [['done', '완료'], ['skip', '건너뜀'], ['fail', '실패'], ['run', '진행 중']];

/** 공고 목록 위의 AI 일괄 재검토 진행·결과 패널. 상태에는 제목이 없어 titleOf로 붙인다. */
export function AiBatchPanel({ state, titleOf, onCancel, onClose, onRetry, onOpenSettings }: {
  state: AiBatchState;
  titleOf: (noticeId: string) => string;
  onCancel: () => void;
  onClose: () => void;
  onRetry: (noticeIds: string[]) => void;
  onOpenSettings: () => void;
}) {
  const active = batchActive(state);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== 'waiting') return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.status, state.waitUntil]);

  const total = state.items.length;
  const cur = currentNoticeId(state);
  const counts = batchCounts(state);
  const retry = retryTargets(state);
  const shown = state.items.filter((it) => it.status !== 'queued' || !active);

  let sub: string;
  if (state.status === 'waiting') sub = `분당 한도 · ${waitSeconds(state, now)}초 후 계속`;
  else if (active) sub = `${progressIndex(state)} / ${total}${cur ? ` · 현재: ${titleOf(cur)}` : ''}`;
  else sub = finishText(state);

  return (
    <section data-ai={state.provider} className="space-y-3 rounded-card border border-ai-line bg-surface p-4 shadow-card" aria-label="AI 일괄 재검토">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ProviderIcon provider={state.provider} size={20} />
        <strong className="text-[0.9375rem]">AI 일괄 재검토</strong>
        <span className="min-w-0 truncate text-sm text-muted tabular-nums">{PROVIDERS[state.provider].label} {state.model} · {sub}</span>
        <span className="flex-1" />
        {active ? <Button variant="secondary" onClick={onCancel}>취소</Button> : <Button variant="secondary" onClick={onClose}>닫기</Button>}
      </div>

      <div className="flex gap-[3px]" role="img" aria-label={`진행 ${progressIndex(state)} / ${total}, 완료 ${counts.done}, 실패 ${counts.failed}, 건너뜀 ${counts.skipped}`}>
        {barCells(state).map((c, i) => <i key={i} className={`h-2 flex-1 rounded-[2px] ${CELL[c]}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {LEGEND.map(([c, label]) => <span key={c} className="inline-flex items-center gap-1.5"><i className={`inline-block size-2.5 rounded-[2px] ${CELL[c].split(' ')[0]}`} />{label}</span>)}
      </div>

      {state.status === 'stopped' && (
        <InlineAlert tone="warn">
          <div className="space-y-2">
            <p>{stopReasonText(state)}</p>
            <div className="flex flex-wrap gap-2">
              {state.stopReason?.code === 'AI_AUTH' && <Button variant="secondary" onClick={onOpenSettings}>설정 열기</Button>}
              {retry.length > 0 && <Button variant="secondary" onClick={() => onRetry(retry)}>남은 공고 다시 실행 ({retry.length}건)</Button>}
            </div>
          </div>
        </InlineAlert>
      )}

      {shown.length > 0 && (
        <div className="grid max-h-64 grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 overflow-y-auto text-sm tabular-nums">
          {shown.map((it) => {
            const r = itemResult(it);
            return (
              <div key={it.noticeId} className="contents">
                <a href={noticeHash(it.noticeId, 'review')} className="truncate text-accent hover:underline">{titleOf(it.noticeId)}</a>
                <span className={`text-right ${TONE[r.tone]}`}>{r.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
