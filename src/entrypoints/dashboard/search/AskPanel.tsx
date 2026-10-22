import { FileSearch, Send, Settings, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ASK_DASHBOARD_TIMEOUT_MS, ASK_FULL_MAX_CHARS, ASK_QUESTION_MAX_CHARS } from '../../../core/search/constants';
import { selectContext } from '../../../core/search/context';
import type { SearchDoc, SearchUnit } from '../../../core/search/types';
import { AI_PROVIDERS, type AiProvider } from '../../../core/types/ai';
import type { AskCitation, AskFile, AskRecord } from '../../../core/types/search';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert, ProviderIcon, Select } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { useAiKeyPresence } from '../../../ui/hooks/useAiRun';
import { useSettings } from '../../../ui/hooks/useSettings';
import { isSetupError } from '../../../ui/review/ai-view';
import { formatDateTime } from '../../../ui/review/format';
import type { DrawerTarget } from '../review/TextDrawer';

/** payload의 항목값 문서 상한(SW 검사와 같은 값). */
const FIELD_DOC_MAX = 20_000;
/** 항목값 가상 문서의 docId(ui/search/field-doc.ts FIELD_DOC_ID와 같다). 이 문서의 인용은 파일이 없어 열 수 없다. */
const FIELD_DOC = 'fields';
const COVERAGE_LABEL: Record<NonNullable<AskRecord['coverage']>, { text: string; cls: string }> = {
  answered: { text: '답함', cls: 'border-ok/30 bg-ok-wash text-ok' },
  partial: { text: '일부만 답함', cls: 'border-warn/30 bg-warn-wash text-warn' },
  not_found: { text: '문서에서 못 찾음', cls: 'border-line bg-sunken text-muted' },
};
const errInfo = (e: unknown): { code?: string; message: string } => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
const shorten = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function SettingsLink({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Button variant="secondary" icon={<Settings />} onClick={() => { onNavigate(); location.hash = '#/settings?section=ai'; }}>AI 설정 열기</Button>
  );
}

/** 근거 한 줄. located가 있으면 누르면 원문 위치로 이동하고, 없으면 회색으로 "원문에서 찾지 못함"을 보인다. */
function CitationRow({ file, page, quote, note, located, partial, onOpen }: {
  file: string | null; page: number | null; quote: string; note?: string; located: AskCitation['located']; partial?: boolean; onOpen: (t: DrawerTarget) => void;
}) {
  const name = file ?? '파일 미상';
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 text-xs">
        <span className="font-semibold text-ink wrap-anywhere">{name}</span>
        {page != null && <span className="text-muted">{page}쪽</span>}
        <span className={located ? 'text-ai-ink' : 'text-faint'}>{located ? `${located.docId === FIELD_DOC ? '항목값에서 ' : ''}근거 위치 확인됨${partial ? '(일부 일치)' : ''}` : '원문에서 찾지 못함(답은 참고만)'}</span>
      </span>
      <span className={`mt-1 block text-sm wrap-anywhere ${located ? 'text-ink' : 'text-muted'}`}>{shorten(quote)}</span>
      {note && <span className="mt-0.5 block text-xs text-muted wrap-anywhere">{note}</span>}
    </>
  );
  const openable = !!located && located.docId !== FIELD_DOC;
  const cls = `block w-full rounded-ctl border px-3 py-2 text-left ${openable ? 'border-ai-line bg-surface hover:bg-ai-wash' : located ? 'border-ai-line bg-surface' : 'border-line bg-sunken'}`;
  return openable && located
    ? <button type="button" className={cls} onClick={() => onOpen({ textPath: located.textPath, line: located.line, quote, title: name })}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** 공고 AI 질문 모드. 대시보드는 로컬에서 컨텍스트 크기만 미리 계산하고, 실제 선정·호출은 엔진(offscreen)이 한다. */
export function AskPanel({ noticeId, docs, units, extractionJobId, detailCapturedAt, seed, onOpen, onNavigate }: {
  noticeId: string; docs: SearchDoc[]; units: SearchUnit[][];
  extractionJobId: string | null; detailCapturedAt: string;
  /** 검색 모드에서 넘어올 때의 질의어. 질문 칸이 비어 있으면 초깃값으로 쓴다. */
  seed: string;
  onOpen: (t: DrawerTarget) => void; onNavigate: () => void;
}) {
  const { settings } = useSettings();
  const keys = useAiKeyPresence();
  const [question, setQuestion] = useState(seed);
  const [picked, setPicked] = useState<AiProvider | null>(null);
  const [history, setHistory] = useState<AskFile | null>(null);
  const [shown, setShown] = useState<AskRecord | null>(null);
  const [running, setRunning] = useState<{ askId: string; docCount: number; chars: number } | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => { if (seed) setQuestion((q) => (q.trim() ? q : seed)); }, [seed]);

  const reloadHistory = () => send('search/asks-get', { noticeId }).then(setHistory, () => undefined);
  useEffect(() => {
    let alive = true;
    send('search/asks-get', { noticeId }).then((f) => { if (alive) setHistory(f); }, () => undefined);
    return () => { alive = false; };
  }, [noticeId]);

  const available = keys ? AI_PROVIDERS.filter((p) => keys[p]) : [];
  const provider: AiProvider | null = picked && available.includes(picked) ? picked
    : settings && available.includes(settings.ai.provider) ? settings.ai.provider : available[0] ?? null;
  const noKey = !!keys && available.length === 0;

  const unitsById = useMemo(() => Object.fromEntries(docs.map((d, i) => [d.id, units[i]!])), [docs, units]);
  const fieldDocText = useMemo(() => (docs.find((d) => d.kind === 'fields')?.lines.join('\n') ?? '').slice(0, FIELD_DOC_MAX), [docs]);
  const deferred = useDeferredValue(question.trim());
  const preview = useMemo(() => {
    if (!deferred) return null;
    const segs = selectContext(docs, unitsById, deferred);
    return { docCount: new Set(segs.map((s) => s.docId)).size, chars: segs.reduce((n, s) => n + s.text.length, 0) };
  }, [docs, unitsById, deferred]);
  const fullChars = useMemo(() => docs.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.length + 1, 0), 0), [docs]);

  const tooLong = question.trim().length > ASK_QUESTION_MAX_CHARS;
  const canSend = !!provider && !running && !!question.trim() && !tooLong;

  const run = async (text: string, contextMode: 'context' | 'full') => {
    if (!provider || running || busyRef.current) return;
    busyRef.current = true;
    const askId = crypto.randomUUID();
    setError(null);
    setRunning(contextMode === 'full'
      ? { askId, docCount: docs.filter((d) => d.lines.length > 0).length, chars: Math.min(fullChars, ASK_FULL_MAX_CHARS) }
      : { askId, docCount: preview?.docCount ?? 0, chars: preview?.chars ?? 0 });
    try {
      const rec = await send('search/ask', { noticeId, askId, question: text, fieldDocText, provider, contextMode }, { timeoutMs: ASK_DASHBOARD_TIMEOUT_MS });
      setShown(rec);
      void reloadHistory();
    } catch (e) {
      const info = errInfo(e);
      if (info.code !== 'AI_RUN_CLOSED') setError(info); // 취소는 오류로 보이지 않는다
      // 응답을 못 받았어도(타임아웃 등) offscreen은 결과를 저장하므로 이력을 다시 읽는다.
      void reloadHistory();
    } finally {
      busyRef.current = false;
      setRunning((r) => (r?.askId === askId ? null : r));
    }
  };
  const cancel = () => { if (running) void send('search/ask-cancel', { noticeId, askId: running.askId }).catch(() => undefined); };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend) void run(question.trim(), 'context');
  };

  const stale = (r: AskRecord): boolean => r.extractionJobId !== extractionJobId || (r.detailCapturedAt ?? '') !== detailCapturedAt;
  const setupBlocked = isSetupError(error?.code);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line px-5 py-3">
        <textarea
          autoFocus rows={3} className={`${inputClass} resize-none`} aria-label="공고 질문" placeholder="이 공고에 대해 질문하세요 (Enter: 질문, Shift+Enter: 줄바꿈)"
          value={question} disabled={!!running} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKeyDown}
        />
        <div className="flex items-center gap-2">
          {provider && <span data-ai={provider} className="grid size-8 shrink-0 place-items-center rounded-full border border-ai-line bg-ai-wash text-ai-ink"><ProviderIcon provider={provider} size={16} /></span>}
          <Select
            className="w-48" aria-label="AI 공급자" value={provider ?? ''} placeholder="사용 가능한 AI 없음" disabled={!!running || available.length === 0}
            options={available.map((p) => ({ value: p, label: PROVIDERS[p].label }))} onChange={(v) => setPicked(v as AiProvider)}
          />
          <span className={`ml-auto text-xs tabular-nums ${tooLong ? 'text-danger' : 'text-muted'}`}>{question.trim().length}/{ASK_QUESTION_MAX_CHARS}</span>
          {running
            ? <Button variant="secondary" icon={<X />} onClick={cancel}>취소</Button>
            : null}
          <Button variant="ai" loading={!!running} icon={<Send />} disabled={!canSend} onClick={() => void run(question.trim(), 'context')}>질문하기</Button>
        </div>
        <p className="min-h-4 text-xs text-muted">
          {running
            ? `문서 ${running.docCount}개 · 약 ${running.chars.toLocaleString('en-US')}자 전송 중…`
            : preview ? `보낼 내용: 문서 ${preview.docCount}개 · 약 ${preview.chars.toLocaleString('en-US')}자` : '질문과 관련된 부분만 골라 AI에 보냅니다.'}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
        {noKey && (
          <InlineAlert tone="warn">
            <div className="space-y-2">
              <p>API 키가 저장된 AI가 없습니다. 설정에서 키를 저장하면 질문할 수 있습니다. 질문은 API 방식으로만 실행합니다.</p>
              <SettingsLink onNavigate={onNavigate} />
            </div>
          </InlineAlert>
        )}
        {error && (
          <InlineAlert tone="error">
            <div className="space-y-2">
              <p>{setupBlocked ? error.message : `${error.code ?? ''} ${error.message}`.trim()}</p>
              {setupBlocked && <SettingsLink onNavigate={onNavigate} />}
            </div>
          </InlineAlert>
        )}
        {shown && <AnswerView rec={shown} stale={stale(shown)} busy={!!running || !provider} onOpen={onOpen} onNavigate={onNavigate} onFull={() => void run(shown.question, 'full')} />}
        {!shown && !running && !error && !noKey && <div className="p-6 text-center text-sm text-muted">공고 문서에 적힌 내용만 근거로 답합니다. 답의 근거 문장이 원문 어디에 있는지 확인할 수 있습니다.</div>}
        {history && history.asks.length > 0 && (
          <section aria-label="질문 이력" className="space-y-1.5">
            <h3 className="text-xs font-semibold text-muted">이전 질문 {history.asks.length}건</h3>
            <ul className="space-y-1">
              {history.asks.map((r) => (
                <li key={r.id}>
                  <button
                    type="button" aria-current={shown?.id === r.id} onClick={() => { setShown(r); setError(null); }}
                    className={`flex w-full items-center gap-2 rounded-ctl border px-3 py-2 text-left text-sm ${shown?.id === r.id ? 'border-ai-line bg-ai-wash' : 'border-line bg-surface hover:bg-sunken'}`}
                  >
                    <ProviderIcon provider={r.provider} size={14} />
                    <span className="min-w-0 flex-1 truncate">{r.question}</span>
                    {r.status === 'failed' && <span className="shrink-0 text-xs text-danger">실패</span>}
                    {stale(r) && <span className="shrink-0 rounded-full bg-sunken px-2 py-px text-xs text-muted">그 뒤 다시 수집됨</span>}
                    <span className="shrink-0 text-xs text-faint tabular-nums">{formatDateTime(r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function AnswerView({ rec, stale, busy, onOpen, onNavigate, onFull }: {
  rec: AskRecord; stale: boolean; busy: boolean; onOpen: (t: DrawerTarget) => void; onNavigate: () => void; onFull: () => void;
}) {
  const cov = rec.coverage ? COVERAGE_LABEL[rec.coverage] : null;
  return (
    <section data-ai={rec.provider} className="space-y-3 rounded-card border border-ai-line bg-ai-wash/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <ProviderIcon provider={rec.provider} size={14} />
        <span>{PROVIDERS[rec.provider]?.label ?? rec.provider} · {rec.model}</span>
        <span>{formatDateTime(rec.createdAt)}</span>
        {rec.contextMode === 'full' && <span className="rounded-full bg-sunken px-2 py-px">전문 질문</span>}
        {stale && <span className="rounded-full bg-sunken px-2 py-px">그 뒤 다시 수집됨</span>}
      </div>
      <p className="text-sm font-semibold text-ink wrap-anywhere">{rec.question}</p>
      {rec.status === 'failed' && (
        <InlineAlert tone="error">
          <div className="space-y-2">
            <p>{isSetupError(rec.error?.code) ? rec.error?.message : `${rec.error?.code ?? ''} ${rec.error?.message ?? '질문에 실패했습니다.'}`.trim()}</p>
            {isSetupError(rec.error?.code) && <SettingsLink onNavigate={onNavigate} />}
          </div>
        </InlineAlert>
      )}
      {rec.status === 'done' && (
        <>
          <div className="flex items-center gap-2">
            {cov && <span className={`rounded-full border px-2 py-px text-xs font-semibold ${cov.cls}`}>{cov.text}</span>}
            {rec.usage && <span className="text-xs text-muted tabular-nums">토큰 {rec.usage.inputTokens.toLocaleString('en-US')} → {rec.usage.outputTokens.toLocaleString('en-US')}</span>}
          </div>
          <p className="text-sm whitespace-pre-wrap text-ink wrap-anywhere">{rec.answer}</p>
          {rec.citations.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="flex items-center gap-1 text-xs font-semibold text-muted"><FileSearch className="size-3.5" />근거 {rec.citations.length}건</h4>
              {rec.citations.map((c, i) => <CitationRow key={i} {...c} onOpen={onOpen} />)}
            </div>
          )}
          {rec.conflicts.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-warn">문서끼리 다르게 말하는 부분</h4>
              {rec.conflicts.map((c, i) => (
                <div key={i} className="space-y-1.5 rounded-ctl border border-warn/30 bg-warn-wash/50 p-3">
                  <p className="text-sm font-semibold wrap-anywhere">{c.topic}</p>
                  {c.values.map((v, j) => (
                    <div key={j} className="space-y-1">
                      <p className="text-sm wrap-anywhere">값: {v.value}</p>
                      <CitationRow file={v.file || null} page={v.located?.page ?? null} quote={v.quote} located={v.located} partial={v.partial} onOpen={onOpen} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {rec.warnings.length > 0 && <ul className="space-y-0.5 text-xs text-warn">{rec.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {rec.coverage !== 'answered' && rec.contextMode !== 'full' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-ai-line pt-3">
              <Button variant="secondary" disabled={busy} onClick={onFull}>전문으로 다시 질문</Button>
              <span className="text-xs text-muted">최대 {Math.round(ASK_FULL_MAX_CHARS / 10_000)}만 자 전송</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
