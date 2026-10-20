import { useEffect, useState } from 'react';
import type { AiReviewFile, AiRun, AiRunState } from '../../../core/types/ai';
import type { Extraction } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { REJECT_LABEL, afterCopy, copyOpenButton, isLimitError, isStale, latestRun, olderCardCount, runSummary, type AiCardInfo } from '../../../ui/review/ai-view';
import type { PromptLoad } from '../../../ui/review/ai-view';
import { formatDateTime } from '../../../ui/review/format';
import { ITEM_LABEL } from '../../../ui/review/view';
import type { ExtractionKey } from '../../../core/types/extraction';
import type { AiDialogPreset } from './AiRunDialog';

const SUBMIT_MAX = 200_000;
const SUBMIT_ERROR: Record<string, string> = {
  AI_CLIPBOARD_IS_PROMPT: '붙여넣은 내용이 요청문입니다. AI의 답변을 복사해 붙여넣으세요',
  AI_RUN_MISMATCH: '다른 요청에 대한 답변입니다. 이번 요청문에 대한 답을 붙여넣으세요',
  AI_BAD_RESPONSE: '답변에서 JSON을 읽지 못했습니다. 코드 블록 전체를 복사했는지 확인하세요',
  AI_RUN_CLOSED: '이미 닫힌 요청입니다',
};
const errText = (e: unknown): { code?: string; message: string } => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

function ManualWait({ noticeId, run, onReload }: { noticeId: string; run: AiRun; onReload: () => void }) {
  const adapter = PROVIDERS[run.provider];
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 클릭 핸들러 안에서 await 없이 바로 writeText하려고 요청문을 미리 받아 둔다(복원 시에도 같다).
  const [prompt, setPrompt] = useState<string | null>(null);
  const [load, setLoad] = useState<PromptLoad>('loading');
  useEffect(() => {
    let alive = true;
    setPrompt(null); setLoad('loading');
    send('ai/prompt-get', { noticeId, runId: run.id }).then(
      (r) => { if (alive) { setPrompt(r.text); setLoad('ready'); } },
      () => { if (alive) setLoad('error'); },
    );
    return () => { alive = false; };
  }, [noticeId, run.id]);

  /** 반드시 복사가 먼저다. 탭을 먼저 열면 문서 포커스를 잃어 writeText가 실패한다. 복사에 실패하면 탭은 열지 않는다. */
  const copy = async (open: boolean) => {
    if (prompt === null) return;
    let ok = true;
    try { await navigator.clipboard.writeText(prompt); } catch { ok = false; }
    const next = afterCopy(ok);
    if (next.openTab && open) window.open(adapter.webUrl, '_blank', 'noopener');
    setMsg(next.message);
  };
  const main = copyOpenButton(load, adapter.label);
  const readClipboard = async () => {
    // permissions.request는 클릭 핸들러의 첫 await여야 한다.
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ['clipboardRead'] }); } catch { granted = false; }
    if (!granted) { setMsg({ tone: 'info', text: '클립보드 읽기 권한이 없어 붙여넣기 칸을 사용합니다' }); return; }
    try { setText(await navigator.clipboard.readText()); setMsg(null); } catch { setMsg({ tone: 'error', text: '클립보드를 읽지 못했습니다. 붙여넣기 칸을 사용하세요' }); }
  };
  const submit = async () => {
    setMsg(null);
    if (!text.trim()) { setMsg({ tone: 'error', text: 'AI의 답변을 붙여넣어 주세요' }); return; }
    if (text.length > SUBMIT_MAX) { setMsg({ tone: 'error', text: '답변이 너무 깁니다(200KB 이하)' }); return; }
    setBusy(true);
    try { await send('ai/submit', { noticeId, runId: run.id, text }, { timeoutMs: 35_000 }); setText(''); onReload(); }
    catch (e) { const er = errText(e); setMsg({ tone: 'error', text: (er.code && SUBMIT_ERROR[er.code]) || `${er.code ?? ''} ${er.message}`.trim() }); if (er.code === 'AI_RUN_CLOSED') onReload(); }
    finally { setBusy(false); }
  };
  const cancel = async () => { try { await send('ai/cancel', { noticeId, runId: run.id }); } catch { /* 이미 닫힘 */ } onReload(); };

  return (
    <div className="space-y-3">
      <p className="text-sm">{adapter.label} 답변을 기다리는 중입니다. 열린 {adapter.label} 탭에 요청문을 붙여넣고, 답(코드 블록)을 복사해 여기로 가져오세요.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={main.disabled} onClick={() => void copy(true)}>{main.label}</Button>
        {main.hint && <span className="text-xs text-muted">{main.hint}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={prompt === null} onClick={() => void copy(false)}>다시 복사</Button>
        <Button variant="secondary" onClick={() => window.open(adapter.webUrl, '_blank', 'noopener')}>탭 다시 열기</Button>
        <Button variant="secondary" onClick={() => void readClipboard()}>클립보드에서 읽기</Button>
      </div>
      <textarea className={inputClass} rows={6} placeholder="AI의 답변(```json … ```)을 붙여넣으세요" value={text} onChange={(e) => setText(e.target.value)} />
      {msg && <InlineAlert tone={msg.tone}>{msg.text}</InlineAlert>}
      <div className="flex gap-2">
        <Button loading={busy} onClick={() => void submit()}>반영</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>취소</Button>
      </div>
    </div>
  );
}

function DoneSummary({ run, extraction, olderCount }: { run: AiRun; extraction: Extraction; olderCount: number }) {
  const [open, setOpen] = useState(false);
  const s = runSummary(run);
  const stale = isStale(run, extraction);
  return (
    <div className="space-y-2 text-sm">
      <div>
        AI 재검토 · {PROVIDERS[run.provider].label} {run.model ?? '반자동'} · {formatDateTime(run.finishedAt ?? run.createdAt)} ·{' '}
        일치 {s.match} / 제안 {s.proposals} / 못 찾음 {s.none} /{' '}
        {s.rejected > 0
          ? <button type="button" className="text-accent hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>검증 실패 {s.rejected}</button>
          : <>검증 실패 0</>}
      </div>
      {stale && <InlineAlert tone="warn">다시 추출되어 이전 AI 제안은 적용할 수 없습니다</InlineAlert>}
      {!stale && olderCount > 0 && <p className="text-muted">이전 run의 제안 {olderCount}개 표시 중</p>}
      {open && (
        <ul className="space-y-1 rounded-ctl border border-line bg-sunken p-3">
          {run.rejected.map((r, i) => (
            <li key={i}>
              <b>{ITEM_LABEL[r.key as ExtractionKey] ?? r.key}</b> · {REJECT_LABEL[r.reason]}
              {r.value !== undefined && <> · 값 {String(r.value).slice(0, 40)}</>}
              {r.quote && <span className="text-muted"> · “{r.quote.slice(0, 80)}”</span>}
            </li>
          ))}
        </ul>
      )}
      {run.skipped.length > 0 && <p className="text-muted">제외 파일: {run.skipped.map((f) => f.name).join(', ')}</p>}
      {run.warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-muted">{run.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  );
}

/** 확인 화면 위쪽의 AI 재검토 상태: 진행 / 반자동 대기 / 완료 요약 / 오류. */
export function AiRunPanel({ noticeId, extraction, review, state, cards, onReload, onOpenDialog }: {
  noticeId: string;
  extraction: Extraction;
  review: AiReviewFile | null | undefined;
  state: AiRunState | null;
  cards: Partial<Record<ExtractionKey, AiCardInfo>>;
  onReload: () => void;
  onOpenDialog: (preset?: AiDialogPreset) => void;
}) {
  const run = latestRun(review);
  if (!run) return null;
  const cancelApi = async () => { try { await send('ai/cancel', { noticeId, runId: run.id }); } catch { /* 이미 끝남 */ } onReload(); };

  let body: React.ReactNode;
  if (run.status === 'requesting') {
    const label = state?.runId === run.id ? state.label : 'AI에 요청하는 중';
    body = (
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>AI 재검토 · {PROVIDERS[run.provider].label} · {label}</span>
        <Button variant="secondary" onClick={() => void cancelApi()}>취소</Button>
      </div>
    );
  } else if (run.status === 'awaiting') {
    body = <ManualWait noticeId={noticeId} run={run} onReload={onReload} />;
  } else if (run.status === 'failed') {
    const code = run.error?.code;
    body = (
      <InlineAlert tone="error">
        <div className="space-y-2">
          <p>AI 재검토 실패 · {PROVIDERS[run.provider].label} · {`${code ?? ''} ${run.error?.message ?? ''}`.trim()}</p>
          {code === 'AI_TIMEOUT' && <p className="text-muted">응답이 오래 걸렸습니다. 가벼운 모델을 선택해 보세요.</p>}
          {isLimitError(code) && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onOpenDialog({ scope: run.scope, provider: run.provider })}>잠시 후 다시</Button>
              <Button variant="secondary" onClick={() => onOpenDialog({ scope: run.scope, expandSwitch: true })}>다른 공급자로 실행</Button>
            </div>
          )}
        </div>
      </InlineAlert>
    );
  } else if (run.status === 'cancelled') {
    body = <p className="text-sm text-muted">AI 재검토가 취소되었습니다.</p>;
  } else {
    body = <DoneSummary run={run} extraction={extraction} olderCount={olderCardCount(cards, run)} />;
  }
  return <div className="rounded-card border border-line bg-surface px-6 py-4 shadow-card">{body}</div>;
}
