import { ChevronDown, ChevronRight, FileSearch } from 'lucide-react';
import { useState } from 'react';
import { pendingKeys } from '../../../core/extraction/review-count';
import type { AiProvider, AiScope } from '../../../core/types/ai';
import type { EvidenceRef, Extraction, ExtractionKey } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert, MenuButton, ProviderIcon, StatusBadge } from '../../../ui/components';
import { useAiKeyPresence, useAiRun } from '../../../ui/hooks/useAiRun';
import { useSettings } from '../../../ui/hooks/useSettings';
import { aiErrorText, aiSetupBlock, buildAiCards, isFindingKey, isSetupError, latestRun, quickView, scopeKeys } from '../../../ui/review/ai-view';
import { DOC_KIND_LABEL, FILE_STATUS_LABEL, buildCards, fileDisplayName, filePagesTables, fileRemark, findTextPath, summarize } from '../../../ui/review/view';
import { EditedMark, ItemCard, type EditError } from '../review/ItemCard';
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

export function ReviewTab({ noticeId, extraction, busy, onExtract, onEdit, onApplied, toast }: {
  noticeId: string;
  extraction: Extraction | null;
  busy: boolean;
  onExtract: () => void;
  onEdit: (key: ExtractionKey, value: unknown | null, note?: string) => Promise<EditError | null>;
  /** AI 제안 적용 결과(notice·extraction)를 상위 상태에 반영한다 */
  onApplied: (r: { notice: Notice; extraction: Extraction }) => void;
  toast: { show: (t: string) => void };
}) {
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [dialog, setDialog] = useState<AiDialogPreset | null>(null);
  const ai = useAiRun(noticeId);
  const { settings } = useSettings();
  const keyPresence = useAiKeyPresence();
  const [starting, setStarting] = useState<ExtractionKey[] | null>(null);
  const [startVia, setStartVia] = useState<AiProvider | null>(null);
  const [aiAlert, setAiAlert] = useState<string | null>(null);

  const openText = (ex: Extraction, e: EvidenceRef) => {
    const textPath = findTextPath(ex.files, e);
    if (!textPath) { toast.show('이 파일의 추출 텍스트가 없습니다'); return; }
    setDrawer({ textPath, line: e.line, title: e.sourceFile });
  };

  if (!extraction) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong py-20 text-muted">
        <FileSearch className="size-9 text-faint" strokeWidth={1.5} />
        <p className="font-semibold text-ink">아직 평가정보를 분석하지 않았습니다</p>
        <Button loading={busy} onClick={onExtract}>평가정보 분석</Button>
      </div>
    );
  }

  const aiCards = buildAiCards(ai.review, extraction);
  const cards = buildCards(extraction, aiCards);
  const counts = summarize(extraction);
  const parsedCount = extraction.files.filter((f) => f.status === 'parsed' && f.textPath).length;
  const lastRun = latestRun(ai.review);
  const qv = quickView(ai.review, extraction, ai.state);
  const aiActive = lastRun?.status === 'requesting' || lastRun?.status === 'awaiting' || qv.phase === 'running' || qv.phase === 'awaiting';
  const pending = pendingKeys(extraction.items);
  const aiMode = settings?.ai.mode ?? 'api';
  const aiProvider = settings?.ai.provider ?? 'gemini';
  // 찾는 중 알약에는 진행 중인 run의 공급자를 쓴다(run이 아직 없으면 세션 state, 그래도 없으면 설정값)
  const runProvider = (lastRun?.status === 'requesting' ? lastRun.provider : undefined) ?? (qv.phase === 'running' ? ai.state?.provider : undefined) ?? startVia ?? aiProvider;
  const aiDisabled = busy || parsedCount === 0 || aiActive || starting !== null || !settings || !keyPresence;
  // 원클릭 실행: 설정 공급자·방식으로 바로 돌린다(provider를 주면 이번만 그 공급자). API인데 키·모델이 없으면 실행 전에 다이얼로그로 안내한다
  const runAi = async (scope: AiScope, keys?: ExtractionKey[], provider?: AiProvider) => {
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
  const aiApply = (key: ExtractionKey, runId: string) => async (note?: string, variantIndex?: number) => {
    try {
      const r = await send('ai/apply', { noticeId, runId, key, note, ...(variantIndex !== undefined ? { variantIndex } : {}) });
      ai.setReview(r.aiReview);
      onApplied({ notice: r.notice, extraction: r.extraction });
      toast.show('저장됨');
      return null;
    } catch (e) { if ((e as { code?: string }).code === 'AI_STALE') void ai.reload(); return errOf(e); }
  };
  const aiDismiss = (key: ExtractionKey, runId: string) => async () => {
    try { ai.setReview(await send('ai/dismiss', { noticeId, runId, key })); return null; } catch (e) { return errOf(e); }
  };

  return (
    <div className="space-y-6" data-ai={aiProvider}>
      <div className="flex items-center gap-6 border-y border-line py-3.5 tabular-nums">
        <StatusBadge status="ok">확인 완료 {counts.verified}</StatusBadge>
        <StatusBadge status="warn">확인 필요 {counts.needsReview}</StatusBadge>
        <EditedMark>직접 수정 {counts.edited}</EditedMark>
        <div className="ml-auto">
          <MenuButton
            tone="ai"
            icon={<ProviderIcon provider={aiProvider} size={16} />}
            label={aiMode === 'manual' ? 'AI로 다시 찾기 (프롬프트)' : 'AI로 다시 찾기'}
            hint={pending.length > 0 ? `확인 필요 ${pending.length}개` : '7개 전체'}
            title={pending.length > 0 ? `확인 필요 ${pending.length}개만 AI로 다시 찾습니다` : '7개 항목 전체를 AI로 다시 찾습니다'}
            disabled={aiDisabled}
            onMain={() => void runAi('auto')}
            items={[
              { key: 'all', label: '7개 항목 전체 재검토', description: '이미 확인된 항목도 AI가 다시 봅니다', onSelect: () => void runAi('all') },
              { key: 'pending', label: `확인 필요 항목만 (${pending.length})`, description: '확인 필요로 남은 항목만 봅니다', disabled: pending.length === 0, onSelect: () => void runAi('pending') },
              ...(Object.keys(PROVIDERS) as AiProvider[]).map((p, i) => ({
                key: `via-${p}`, label: `${PROVIDERS[p].label}로 다시 찾기`, dividerBefore: i === 0,
                description: p === aiProvider ? '기본 공급자' : '이번만 이 AI로 실행(설정은 그대로)',
                onSelect: () => void runAi('auto', undefined, p),
              })),
              { key: 'options', label: '옵션 열기…', description: '공급자·방식 바꾸기, 분석할 파일 고르기', dividerBefore: true, onSelect: () => setDialog({}) },
            ]}
          />
        </div>
      </div>
      {aiAlert && <InlineAlert tone="error">{aiAlert}</InlineAlert>}
      <AiRunPanel noticeId={noticeId} extraction={extraction} review={ai.review} state={ai.state} cards={aiCards} onReload={() => void ai.reload()} onOpenDialog={(p) => setDialog(p ?? {})} />
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {cards.map((c) => (
          <ItemCard
            key={c.key} card={c} busy={busy} aiProvider={runProvider} aiDisabled={aiDisabled}
            aiFinding={isFindingKey(lastRun, c.key) || (starting?.includes(c.key) ?? false)}
            {...(pending.includes(c.key) ? { onAiFind: () => void runAi('keys', [c.key]) } : {})} onEdit={(v, note) => onEdit(c.key, v, note)} onOpenText={(e) => openText(extraction, e)}
            {...(c.ai ? { onAiApply: aiApply(c.key, c.ai.run.id), onAiDismiss: aiDismiss(c.key, c.ai.run.id) } : {})}
          />
        ))}
      </div>

      <Collapsible title={`분석한 파일 (${extraction.files.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-sunken text-muted">
              <tr>{['이름', '종류', '상태', '쪽/표 수', '소요(ms)', '비고'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {extraction.files.map((f, i) => (
                <tr key={i} className={`border-t border-line ${f.status === 'parsed' ? '' : 'text-faint'}`}>
                  <td className="max-w-xs px-5 py-3 wrap-anywhere">{fileDisplayName(f)}</td>
                  <td className="px-5 py-3">{DOC_KIND_LABEL[f.docKind] ?? f.docKind}</td>
                  <td className="px-5 py-3">{FILE_STATUS_LABEL[f.status] ?? f.status}</td>
                  <td className="px-5 py-3">{filePagesTables(f)}</td>
                  <td className="px-5 py-3 font-mono tabular-nums">{f.ms ?? '—'}</td>
                  <td className="px-5 py-3">{fileRemark(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      {extraction.warnings.length > 0 && (
        <Collapsible title={`경고 (${extraction.warnings.length})`}>
          <ul className="list-disc space-y-1.5 py-4 pr-5 pl-10 text-sm text-muted">
            {extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Collapsible>
      )}

      {dialog && (
        <AiRunDialog noticeId={noticeId} extraction={extraction} pendingCount={pending.length} preset={dialog} onClose={() => setDialog(null)} onStarted={() => void ai.reload()} />
      )}
      {drawer && <TextDrawer noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
