import { ChevronDown, ChevronRight, FileSearch, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { pendingKeys } from '../../../core/extraction/review-count';
import type { EvidenceRef, Extraction, ExtractionKey } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import { send } from '../../../messaging/bus';
import { Button, StatusBadge } from '../../../ui/components';
import { useAiRun } from '../../../ui/hooks/useAiRun';
import { buildAiCards, latestRun } from '../../../ui/review/ai-view';
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
  const aiActive = lastRun?.status === 'requesting' || lastRun?.status === 'awaiting';
  const errOf = (e: unknown) => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
  const aiApply = (key: ExtractionKey, runId: string) => async (note?: string) => {
    try {
      const r = await send('ai/apply', { noticeId, runId, key, note });
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
    <div className="space-y-6">
      <div className="flex items-center gap-6 border-y border-line py-3.5 tabular-nums">
        <StatusBadge status="ok">확인 완료 {counts.verified}</StatusBadge>
        <StatusBadge status="warn">확인 필요 {counts.needsReview}</StatusBadge>
        <EditedMark>직접 수정 {counts.edited}</EditedMark>
        <div className="ml-auto">
          <Button variant="secondary" icon={<Sparkles />} disabled={busy || parsedCount === 0 || aiActive} onClick={() => setDialog({})}>AI로 다시 찾기</Button>
        </div>
      </div>
      <AiRunPanel noticeId={noticeId} extraction={extraction} review={ai.review} state={ai.state} cards={aiCards} onReload={() => void ai.reload()} onOpenDialog={(p) => setDialog(p ?? {})} />
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {cards.map((c) => (
          <ItemCard
            key={c.key} card={c} busy={busy} onEdit={(v, note) => onEdit(c.key, v, note)} onOpenText={(e) => openText(extraction, e)}
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
                  <td className="max-w-xs px-5 py-3 break-all">{fileDisplayName(f)}</td>
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
        <AiRunDialog noticeId={noticeId} extraction={extraction} pendingCount={pendingKeys(extraction.items).length} preset={dialog} onClose={() => setDialog(null)} onStarted={() => void ai.reload()} />
      )}
      {drawer && <TextDrawer noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
