import { Check, ClipboardPaste, Copy, ExternalLink, Repeat2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AiProvider, AiReviewFile, AiRun, AiRunState } from '../../../core/types/ai';
import type { Extraction } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, FormActions, InlineAlert, ProviderIcon } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { REJECT_LABEL, afterCopy, compareAgreementSummary, compareRows, copyOpenButton, isLimitError, isStale, latestRun, olderCardCount, runSummary, scopeLabel, type AiCardInfo } from '../../../ui/review/ai-view';
import type { PromptLoad } from '../../../ui/review/ai-view';
import { formatDateTime } from '../../../ui/review/format';
import { ITEM_LABEL } from '../../../ui/review/view';
import type { ExtractionKey } from '../../../core/types/extraction';
import type { AiDialogPreset } from './AiRunDialog';

const SUBMIT_MAX = 200_000;

/** 거부 목록 라벨. 조건별 값 거부는 키가 `<항목>#<i>`라 "항목 · 조건 i+1"로 보여 준다. */
const rejectLabel = (key: string): string => {
  const [k, i] = key.split('#');
  const label = ITEM_LABEL[k as ExtractionKey] ?? k!;
  return i === undefined ? label : `${label} · 조건 ${Number(i) + 1}`;
};
const SUBMIT_ERROR: Record<string, string> = {
  AI_CLIPBOARD_IS_PROMPT: '붙여넣은 내용이 프롬프트입니다. AI의 답변을 복사해 붙여넣으세요',
  AI_RUN_MISMATCH: '다른 요청에 대한 답변입니다. 이번 프롬프트에 대한 답을 붙여넣으세요',
  AI_BAD_RESPONSE: '답변에서 JSON을 읽지 못했습니다. 코드 블록 전체를 복사했는지 확인하세요',
  AI_RUN_CLOSED: '이미 닫힌 요청입니다',
};
const errText = (e: unknown): { code?: string; message: string } => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

/** 반자동 대기 화면의 번호 단계 한 칸 */
function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-ctl border border-ai-line bg-surface/60 p-4">
      <div className="flex items-center gap-2">
        <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums ${done ? 'bg-ok text-surface' : 'border border-ai-line bg-ai-wash text-ai-ink'}`}>
          {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
        </span>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      {children}
    </li>
  );
}

const linkBtn = 'inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5';

function ManualWait({ noticeId, run, onReload, onOpenDialog }: { noticeId: string; run: AiRun; onReload: () => void; onOpenDialog: (preset?: AiDialogPreset) => void }) {
  const adapter = PROVIDERS[run.provider];
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 클릭 핸들러 안에서 await 없이 바로 writeText하려고 요청문을 미리 받아 둔다(복원 시에도 같다).
  const [prompt, setPrompt] = useState<string | null>(null);
  const [load, setLoad] = useState<PromptLoad>('loading');
  const [copied, setCopied] = useState(false);
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
    if (ok) setCopied(true);
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
  /** 기다리던 요청은 닫고, 같은 범위로 공급자 선택을 펼친 실행 창을 연다. */
  const switchProvider = async () => {
    await cancel();
    onOpenDialog({ scope: run.scope, ...(run.scope === 'keys' ? { keys: run.keys } : {}), expandSwitch: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ProviderIcon provider={run.provider} size={20} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{adapter.label}에 직접 물어보기 · {scopeLabel(run)}</div>
          <div className="text-xs text-muted">{adapter.label} 답변을 기다리는 중입니다. 아래 순서대로 진행하세요</div>
        </div>
        <button type="button" className={linkBtn} disabled={busy} onClick={() => void switchProvider()}><Repeat2 />다른 AI로 바꾸기</button>
      </div>

      <ol className="grid gap-3 md:grid-cols-3">
        <Step n={1} title="프롬프트 복사" done={copied}>
          <Button variant="ai" icon={<ExternalLink />} disabled={main.disabled} onClick={() => void copy(true)}>{main.label}</Button>
          {main.hint
            ? <span className="text-xs text-muted">{main.hint}</span>
            : (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <button type="button" className={linkBtn} disabled={prompt === null} onClick={() => void copy(false)}><Copy />다시 복사</button>
                <button type="button" className={linkBtn} onClick={() => window.open(adapter.webUrl, '_blank', 'noopener')}><ExternalLink />탭 다시 열기</button>
              </div>
            )}
        </Step>
        <Step n={2} title={`${adapter.label}에 붙여넣고 보내기`}>
          <p className="text-sm text-muted">열린 {adapter.label} 탭의 입력창에 붙여넣고(Ctrl+V) 보내세요. 답이 끝날 때까지 기다립니다.</p>
        </Step>
        <Step n={3} title="답변 가져오기" done={text.trim().length > 0}>
          <p className="text-sm text-muted">답변의 코드 블록(<span className="font-mono text-xs">```json</span>)을 복사해 아래 칸에 붙여넣으세요.</p>
          <button type="button" className={linkBtn} onClick={() => void readClipboard()}><ClipboardPaste />클립보드에서 바로 읽기</button>
        </Step>
      </ol>

      <textarea className={`${inputClass} font-mono text-xs leading-relaxed`} rows={6} aria-label="AI 답변" placeholder="AI의 답변(```json … ```)을 붙여넣으세요" value={text} onChange={(e) => setText(e.target.value)} />
      {msg && <InlineAlert tone={msg.tone === 'info' ? 'ai' : msg.tone}>{msg.text}</InlineAlert>}
      <FormActions>
        <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>취소</Button>
        <Button variant="ai" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>반영</Button>
      </FormActions>
    </div>
  );
}

function DoneSummary({ run, extraction, olderCount }: { run: AiRun; extraction: Extraction; olderCount: number }) {
  const [open, setOpen] = useState(false);
  const s = runSummary(run);
  const stale = isStale(run, extraction);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <ProviderIcon provider={run.provider} size={20} />
        <span title={formatDateTime(run.finishedAt ?? run.createdAt)}>
          <b>{PROVIDERS[run.provider].label}</b> <span className="tabular-nums text-muted">{run.model ?? '프롬프트 복사'}</span> · {scopeLabel(run)} 재검토 완료
        </span>
        <span className="flex-1" />
        <span className="flex gap-3.5 text-[0.8125rem] text-muted tabular-nums">
          <span>제안 <b className="text-ink">{s.proposals}</b></span>
          {!!s.multi && <span>조건별 <b className="text-ink">{s.multi}개</b></span>}
          <span>일치 <b className="text-ink">{s.match}</b></span>
          <span>못 찾음 <b className="text-ink">{s.none}</b></span>
          {s.rejected > 0
            ? <button type="button" className="text-accent hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>검증 실패 <b>{s.rejected}</b></button>
            : <span>검증 실패 <b className="text-ink">0</b></span>}
        </span>
      </div>
      {stale && <InlineAlert tone="warn">다시 추출되어 이전 AI 제안은 적용할 수 없습니다</InlineAlert>}
      {!stale && olderCount > 0 && <p className="text-muted">이전 run의 제안 {olderCount}개 표시 중</p>}
      {open && (
        <ul className="space-y-1 rounded-ctl border border-line bg-sunken p-3">
          {run.rejected.map((r, i) => (
            <li key={i}>
              <b>{rejectLabel(r.key)}</b> · {REJECT_LABEL[r.reason]}
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

/** 비교 실행(여러 AI) 요약: 공급자별 한 행과 일치 요약 한 줄. */
function CompareSummary({ cmp, state, stale, cards, others, noticeId, onReload, onOpenDialog }: {
  cmp: NonNullable<ReturnType<typeof compareRows>>;
  state: AiRunState | null;
  stale: boolean;
  cards: Partial<Record<ExtractionKey, AiCardInfo>>;
  others: Partial<Record<ExtractionKey, AiCardInfo[]>>;
  noticeId: string;
  onReload: () => void;
  onOpenDialog: (preset?: AiDialogPreset) => void;
}) {
  const { scopeRun } = cmp;
  const rerun = (provider: AiProvider) => onOpenDialog({ scope: scopeRun.scope, ...(scopeRun.scope === 'keys' ? { keys: scopeRun.keys } : {}), provider });
  const cancel = async () => { try { if (state) await send('ai/cancel', { noticeId, runId: state.runId }); } catch { /* 이미 끝남 */ } onReload(); };
  const sum = compareAgreementSummary(cards, others);
  const sumLine = sum.agree + sum.differ + sum.partial + sum.none > 0
    ? `비교 항목 ${sum.compared}개 · 일치 ${sum.agree} · 다름 ${sum.differ} · 일부만 찾음 ${sum.partial}` : null;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">AI 비교 · {scopeLabel(scopeRun)}</p>
      {stale && <InlineAlert tone="warn">다시 추출되어 이전 AI 제안은 적용할 수 없습니다</InlineAlert>}
      <ul className="space-y-1.5">
        {cmp.rows.map((r) => (
          <li key={r.provider} data-ai={r.provider} className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <ProviderIcon provider={r.provider} size={16} />
            <span><b>{PROVIDERS[r.provider].label}</b>{r.run?.model && <span className="tabular-nums text-muted"> {r.run.model}</span>}</span>
            <span className="flex-1" />
            {r.status === 'done' && r.summary && (
              <span className="flex gap-3.5 text-[0.8125rem] text-muted tabular-nums">
                <span>제안 <b className="text-ink">{r.summary.proposals}</b></span>
                <span>일치 <b className="text-ink">{r.summary.match}</b></span>
                <span>못 찾음 <b className="text-ink">{r.summary.none}</b></span>
                <span>검증 실패 <b className="text-ink">{r.summary.rejected}</b></span>
              </span>
            )}
            {r.status === 'running' && (
              <>
                <span className="flex items-center gap-2 text-muted"><span className="inline-flex animate-spin motion-reduce:animate-none"><ProviderIcon provider={r.provider} size={14} /></span>{state?.label ?? 'AI에 요청하는 중'}</span>
                <Button variant="secondary" onClick={() => void cancel()}>취소</Button>
              </>
            )}
            {r.status === 'failed' && (
              <>
                <span className="text-danger">{`${r.run?.error?.code ?? ''} ${r.run?.error?.message ?? ''}`.trim()}</span>
                <Button variant="secondary" onClick={() => rerun(r.provider)}>다시 실행</Button>
              </>
            )}
            {r.status === 'cancelled' && <span className="text-muted">취소됨</span>}
            {r.status === 'queued' && <span className="text-muted">대기</span>}
            {r.status === 'missing' && (
              <>
                <span className="text-muted">실행되지 않음</span>
                <Button variant="secondary" onClick={() => rerun(r.provider)}>실행</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {sumLine && <p className="text-[0.8125rem] text-muted tabular-nums">{sumLine}</p>}
    </div>
  );
}

/** 확인 화면 위쪽의 AI 재검토 상태: 진행 / 반자동 대기 / 완료 요약 / 오류. */
export function AiRunPanel({ noticeId, extraction, review, state, cards, others = {}, onReload, onOpenDialog }: {
  noticeId: string;
  extraction: Extraction;
  review: AiReviewFile | null | undefined;
  state: AiRunState | null;
  cards: Partial<Record<ExtractionKey, AiCardInfo>>;
  /** 다른 공급자의 제안(비교 요약용) */
  others?: Partial<Record<ExtractionKey, AiCardInfo[]>>;
  onReload: () => void;
  onOpenDialog: (preset?: AiDialogPreset) => void;
}) {
  const run = latestRun(review);
  if (!run) return null;
  const cancelApi = async () => { try { await send('ai/cancel', { noticeId, runId: run.id }); } catch { /* 이미 끝남 */ } onReload(); };

  const cmp = compareRows(review, state);
  if (cmp) {
    const running = cmp.rows.find((r) => r.status === 'running');
    const firstStale = cmp.rows[0]?.run ? isStale(cmp.rows[0].run, extraction) : false;
    return (
      <div {...(running ? { 'data-ai': running.provider } : {})} className="ai-tint rounded-card border border-ai-line bg-ai-wash px-6 py-4">
        <CompareSummary cmp={cmp} state={state} stale={firstStale} cards={cards} others={others} noticeId={noticeId} onReload={onReload} onOpenDialog={onOpenDialog} />
      </div>
    );
  }

  let body: React.ReactNode;
  if (run.status === 'requesting') {
    const label = state?.runId === run.id ? state.label : 'AI에 요청하는 중';
    body = (
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2">
          <span className="inline-flex animate-spin motion-reduce:animate-none"><ProviderIcon provider={run.provider} size={16} /></span>
          AI 재검토 · {PROVIDERS[run.provider].label} · {scopeLabel(run)} · {label}
        </span>
        <Button variant="secondary" onClick={() => void cancelApi()}>취소</Button>
      </div>
    );
  } else if (run.status === 'awaiting') {
    body = <ManualWait noticeId={noticeId} run={run} onReload={onReload} onOpenDialog={onOpenDialog} />;
  } else if (run.status === 'failed') {
    const code = run.error?.code;
    body = (
      <InlineAlert tone="error">
        <div className="space-y-2">
          <p>AI 재검토 실패 · {PROVIDERS[run.provider].label} · {`${code ?? ''} ${run.error?.message ?? ''}`.trim()}</p>
          {code === 'AI_TIMEOUT' && <p className="text-muted">응답이 오래 걸렸습니다. 가벼운 모델을 선택하거나, 설정의 AI 문서 전달을 '관련 구간만 전송'으로 바꿔 보세요.</p>}
          {code === 'AI_BAD_REQUEST' && <p className="text-muted">문서가 커서 AI가 받지 못했을 수 있습니다. 설정의 AI 문서 전달을 '관련 구간만 전송'으로 바꿔 다시 실행해 보세요.</p>}
          {isLimitError(code) && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onOpenDialog({ scope: run.scope, ...(run.scope === 'keys' ? { keys: run.keys } : {}), provider: run.provider })}>잠시 후 다시</Button>
              <Button variant="secondary" onClick={() => onOpenDialog({ scope: run.scope, ...(run.scope === 'keys' ? { keys: run.keys } : {}), expandSwitch: true })}>다른 공급자로 실행</Button>
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
  const aiTone = run.status === 'done' || run.status === 'requesting' || run.status === 'awaiting';
  return <div data-ai={run.provider} className={`rounded-card border px-6 py-4 ${aiTone ? 'ai-tint border-ai-line bg-ai-wash' : 'border-line bg-surface shadow-card'}`}>{body}</div>;
}
