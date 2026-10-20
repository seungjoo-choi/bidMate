import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { pendingLeafKeys, rowKeyOf, type ReviewLeafKey, type ReviewRowKey } from '../../../core/extraction/review-rows';
import type { AiKey } from '../../../core/ai/keys';
import type { AiProvider, AiScope } from '../../../core/types/ai';
import type { EvidenceRef, Extraction } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert, MenuButton, ProviderIcon } from '../../../ui/components';
import { useAiKeyPresence, useAiRun } from '../../../ui/hooks/useAiRun';
import { useSettings } from '../../../ui/hooks/useSettings';
import { aiErrorText, aiSetupBlock, aiOthers, buildAiCards, buildAiCardsByProvider, isFindingKey, isSetupError, latestRun, quickView, scopeKeys } from '../../../ui/review/ai-view';
import { autoOpen, buildReviewRows, nextPendingRowKey, summarizeRows } from '../../../ui/review/rows';
import { DOC_KIND_LABEL, FILE_STATUS_LABEL, fileDisplayName, filePagesTables, fileRemark, findTextPath } from '../../../ui/review/view';
import type { EditError } from '../review/ReviewRows';
import { ReviewRowItem, ReviewSummary, type LeafActions, type OpenOverride } from '../review/ReviewRows';
import { AiRunDialog, type AiDialogPreset } from '../review/AiRunDialog';
import { AiRunPanel } from '../review/AiRunPanel';
import { TextDrawer, type DrawerTarget } from '../review/TextDrawer';

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <button className="flex w-full items-center gap-2 px-5 py-4 text-left text-base font-semibold hover:bg-sunken" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        {title}
      </button>
      {open && <div className="border-t border-line">{children}</div>}
    </section>
  );
}

export function ReviewTab({ noticeId, notice, extraction, busy, onExtract, onEdit, onApplied, toast }: {
  noticeId: string;
  notice: Notice;
  extraction: Extraction | null;
  busy: boolean;
  onExtract: () => void;
  onEdit: (key: ReviewLeafKey, value: unknown | null, note?: string, raw?: string) => Promise<EditError | null>;
  /** AI 제안 적용 결과(notice·extraction)를 상위 상태에 반영한다 */
  onApplied: (r: { notice: Notice; extraction: Extraction }) => void;
  toast: { show: (t: string) => void };
}) {
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [dialog, setDialog] = useState<AiDialogPreset | null>(null);
  // ▾ 메뉴 상단 AI 탭에서 고른 공급자. 이번 실행에만 쓰고 메뉴가 닫히면 기본(설정)으로 돌아간다
  const [menuVia, setMenuVia] = useState<AiProvider | null>(null);
  const ai = useAiRun(noticeId);
  const { settings } = useSettings();
  const keyPresence = useAiKeyPresence();
  const [starting, setStarting] = useState<AiKey[] | null>(null);
  const [startVia, setStartVia] = useState<AiProvider | null>(null);
  const [aiAlert, setAiAlert] = useState<string | null>(null);
  // 행 열림을 사용자가 직접 바꾼 경우만 기록한다. 없으면 autoOpen(결정이 필요한 행만 펼침)을 따른다
  const [openOverride, setOpenOverride] = useState<OpenOverride>({});
  const [lastJump, setLastJump] = useState<ReviewRowKey | undefined>(undefined);
  // 저장이 끝나면 그 행의 수동 열림 기록을 지워, 처리된 행은 자동 규칙대로 접히게 한다
  const clearOverride = (key: ReviewLeafKey) => {
    const rk = rowKeyOf(key);
    setOpenOverride((o) => { const n = { ...o }; delete n[rk]; return n; });
  };

  const openText = (e: EvidenceRef) => {
    const textPath = extraction ? findTextPath(extraction.files, e) : null;
    if (!textPath) { toast.show('이 파일의 추출 텍스트가 없습니다'); return; }
    setDrawer({ textPath, line: e.line, title: e.sourceFile, quote: e.evidence });
  };

  const aiCards = extraction ? buildAiCards(ai.review, extraction) : {};
  const others = extraction ? aiOthers(aiCards, buildAiCardsByProvider(ai.review, extraction)) : {};
  const rows = buildReviewRows(notice, extraction, aiCards, others);
  const summary = summarizeRows(rows);
  const parsedCount = extraction ? extraction.files.filter((f) => f.status === 'parsed' && f.textPath).length : 0;
  const lastRun = latestRun(ai.review);
  const qv = extraction ? quickView(ai.review, extraction, ai.state) : null;
  const aiActive = lastRun?.status === 'requesting' || lastRun?.status === 'awaiting' || qv?.phase === 'running' || qv?.phase === 'awaiting';
  // AI 범위는 탭 배지와 같은 13행(잎 16개) 기준
  const pending = pendingLeafKeys(notice, extraction);
  const aiMode = settings?.ai.mode ?? 'api';
  const aiProvider = settings?.ai.provider ?? 'gemini';
  // 찾는 중 알약에는 진행 중인 run의 공급자를 쓴다(run이 아직 없으면 세션 state, 그래도 없으면 설정값)
  const runProvider = (lastRun?.status === 'requesting' ? lastRun.provider : undefined) ?? (qv?.phase === 'running' ? ai.state?.provider : undefined) ?? startVia ?? aiProvider;
  const aiDisabled = busy || parsedCount === 0 || aiActive || starting !== null || !settings || !keyPresence;
  // 원클릭 실행: 설정 공급자·방식으로 바로 돌린다(provider를 주면 이번만 그 공급자). API인데 키·모델이 없으면 실행 전에 다이얼로그로 안내한다
  const runAi = async (scope: AiScope, keys?: AiKey[], provider?: AiProvider) => {
    if (!settings) return;
    setAiAlert(null);
    const via = provider ? { provider } : {};
    const block = aiSetupBlock({ ...settings.ai, ...via }, keyPresence);
    if (block) { setDialog({ scope, ...(keys ? { keys } : {}), ...via, initialError: block }); return; }
    setStarting(scopeKeys(scope, keys, pending));
    setStartVia(provider ?? null);
    try {
      const payload = { noticeId, scope, ...(keys ? { keys } : {}), ...via };
      if (aiMode === 'manual') await send('ai/prepare', payload, { timeoutMs: 35_000 });
      else await send('ai/run', payload, { timeoutMs: 70_000 });
      await ai.reload();
    } catch (e) {
      const er = errOf(e);
      if (isSetupError(er.code)) setDialog({ scope, ...(keys ? { keys } : {}), ...(provider ? { provider } : {}), initialError: er });
      else setAiAlert(aiErrorText(er.code, er.message));
      void ai.reload();
    } finally {
      setStarting(null);
      setStartVia(null);
    }
  };
  const errOf = (e: unknown) => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
  const aiApply = (key: AiKey) => async (runId: string, note?: string, variantIndex?: number) => {
    try {
      const r = await send('ai/apply', { noticeId, runId, key, note, ...(variantIndex !== undefined ? { variantIndex } : {}) });
      ai.setReview(r.aiReview);
      onApplied({ notice: r.notice, extraction: r.extraction });
      clearOverride(key);
      toast.show('저장됨');
      return null;
    } catch (e) { if ((e as { code?: string }).code === 'AI_STALE') void ai.reload(); return errOf(e); }
  };
  const aiDismiss = (key: AiKey) => async (runId: string) => {
    try { ai.setReview(await send('ai/dismiss', { noticeId, runId, key })); return null; } catch (e) { return errOf(e); }
  };

  const isOpen = (k: ReviewRowKey) => {
    const row = rows.find((r) => r.key === k)!;
    return openOverride[k] ?? autoOpen(row);
  };
  const jump = () => {
    const k = nextPendingRowKey(rows, lastJump);
    if (!k) return;
    setLastJump(k);
    setOpenOverride((o) => ({ ...o, [k]: true }));
    requestAnimationFrame(() => document.getElementById(`review-row-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const editLeaf = async (key: ReviewLeafKey, value: unknown | null, note?: string, raw?: string) => {
    const err = await onEdit(key, value, note, raw);
    if (!err) clearOverride(key);
    return err;
  };
  const leafActions: LeafActions = {
    busy, aiDisabled, aiProvider: runProvider,
    isFinding: (k) => isFindingKey(lastRun, k) || (starting?.includes(k) ?? false),
    onAiFind: (k) => void runAi('keys', [k]),
    onEdit: editLeaf,
    onOpenText: openText,
    onAiApply: aiApply,
    onAiDismiss: aiDismiss,
  };

  const aiMenu = extraction && (
          <MenuButton
            tone="ai"
            icon={<ProviderIcon provider={aiProvider} size={16} />}
            label={aiMode === 'manual' ? 'AI로 다시 찾기 (프롬프트)' : 'AI로 다시 찾기'}
            hint={pending.length > 0 ? `확인 필요 ${pending.length}개` : '13개 항목 전체'}
            title={pending.length > 0 ? `확인 필요 ${pending.length}개만 AI로 다시 찾습니다` : '13개 항목 전체를 AI로 다시 찾습니다'}
            disabled={aiDisabled}
            onMain={() => void runAi('auto')}
            onOpenChange={(o) => { if (!o) setMenuVia(null); }}
            header={(
              <div className="px-1.5 pt-1 pb-2">
                <div className="mb-1.5 px-1 text-xs text-muted">사용할 AI <span className="text-faint">(이번만 적용)</span></div>
                <div role="radiogroup" aria-label="사용할 AI" className="grid grid-cols-3 gap-1 rounded-ctl bg-sunken p-1">
                  {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => {
                    const on = (menuVia ?? aiProvider) === p;
                    return (
                      <button
                        key={p} type="button" role="radio" aria-checked={on} data-ai={p}
                        title={p === aiProvider ? `${PROVIDERS[p].label} (기본)` : `이번만 ${PROVIDERS[p].label}로 실행`}
                        onClick={() => setMenuVia(p === aiProvider ? null : p)}
                        className={`flex h-8 items-center justify-center gap-1.5 rounded-ctl border text-sm transition-colors motion-reduce:transition-none ${on ? 'border-ai-line bg-ai-wash font-semibold text-ai-ink shadow-card' : 'border-transparent text-muted hover:bg-surface hover:text-ink'}`}
                      >
                        <ProviderIcon provider={p} size={14} />
                        {PROVIDERS[p].label}
                      </button>
                    );
                  })}
                </div>
                <hr className="mt-2 border-line" />
              </div>
            )}
            items={[
              { key: 'all', label: '13개 항목 전체 재검토', description: '이미 확인된 항목도 AI가 다시 봅니다', onSelect: () => void runAi('all', undefined, menuVia ?? undefined) },
              { key: 'pending', label: `확인 필요 항목만 (${pending.length})`, description: '확인 필요로 남은 항목만 봅니다', disabled: pending.length === 0, onSelect: () => void runAi('pending', undefined, menuVia ?? undefined) },
              { key: 'compare', label: '여러 AI로 비교…', description: 'Claude·OpenAI·Gemini 결과를 나란히 봅니다', onSelect: () => setDialog({ compare: true }) },
              { key: 'options', label: '옵션 열기…', description: '방식 바꾸기, 분석할 파일 고르기', dividerBefore: true, onSelect: () => setDialog(menuVia ? { provider: menuVia } : {}) },
            ]}
          />
  );

  return (
    <div className="space-y-5" data-ai={aiProvider}>
      <ReviewSummary
        rows={rows} summary={summary} onJump={jump}
        actions={extraction ? aiMenu : <Button className="!h-8 !px-3 !text-[0.8125rem]" loading={busy} onClick={onExtract}>문서에서 평가정보 분석</Button>}
      />
      {aiAlert && <InlineAlert tone="error">{aiAlert}</InlineAlert>}
      {extraction && <AiRunPanel noticeId={noticeId} extraction={extraction} review={ai.review} state={ai.state} cards={aiCards} others={others} onReload={() => void ai.reload()} onOpenDialog={(p) => setDialog(p ?? {})} />}
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {rows.map((r) => (
          <ReviewRowItem key={r.key} row={r} open={isOpen(r.key)} onToggle={() => setOpenOverride((o) => ({ ...o, [r.key]: !isOpen(r.key) }))} a={leafActions} />
        ))}
      </div>

      {extraction && <Collapsible title={`분석한 파일 (${extraction.files.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-sunken text-muted">
              <tr>{['이름', '종류', '상태', '쪽/표 수', '비고'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {extraction.files.map((f, i) => (
                <tr key={i} className={`border-t border-line ${f.status === 'parsed' ? '' : 'text-faint'}`}>
                  <td className="max-w-xs px-5 py-3 wrap-anywhere">{fileDisplayName(f)}</td>
                  <td className="px-5 py-3">{DOC_KIND_LABEL[f.docKind] ?? f.docKind}</td>
                  <td className="px-5 py-3">{FILE_STATUS_LABEL[f.status] ?? f.status}</td>
                  <td className="px-5 py-3">{filePagesTables(f)}</td>
                  <td className="px-5 py-3">{fileRemark(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>}

      {extraction && extraction.warnings.length > 0 && (
        <Collapsible title={`경고 (${extraction.warnings.length})`}>
          <ul className="list-disc space-y-1.5 py-4 pr-5 pl-10 text-sm text-muted">
            {extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Collapsible>
      )}

      {dialog && extraction && (
        <AiRunDialog noticeId={noticeId} extraction={extraction} pendingCount={pending.length} preset={dialog} onClose={() => setDialog(null)} onStarted={() => void ai.reload()} />
      )}
      {drawer && <TextDrawer noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
