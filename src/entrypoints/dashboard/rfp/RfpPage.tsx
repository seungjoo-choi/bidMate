import { ArrowRight, ArrowLeftRight, ChevronRight, Clock, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IndexEntry } from '../../../core/types/index-file';
import type { RfpCompareEntry, RfpDocCandidate, RfpUploadEntry } from '../../../core/types/rfp';
import { send } from '../../../messaging/bus';
import { Button, ConfirmDialog, EmptyState, InlineAlert, useToast } from '../../../ui/components';
import { formatDateTime } from '../../../ui/review/format';
import { PageTitle } from '../menu';
import { rfpCompareHash } from '../route';
import { DocSlot, ExtBadge, QualityBadge, type Side, type SlotData } from './DocSlot';
import { NoticePicker, type PickerBase } from './NoticePicker';
import { SideChip } from './SideChip';
import { bytesToBase64, checkUploadFile, defaultCandidate, formatSize, orgLabel, orgOf, sameRef, slotUsable } from './rfp-page-logic';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const other = (s: Side): Side => (s === 'prev' ? 'next' : 'prev');

function noticeSlot(entry: IndexEntry, cands: RfpDocCandidate[], cand: RfpDocCandidate): SlotData {
  return {
    ref: cand.ref, status: 'loading', title: entry.title, subtitle: cand.name, fileName: cand.name,
    source: 'notice', org: orgOf(entry), orgLabel: orgLabel(entry), noticeId: entry.noticeId, date: entry.collectedAt, candidates: cands,
  };
}

function uploadSlot(u: RfpUploadEntry): SlotData {
  return {
    ref: { kind: 'upload', uploadId: u.uploadId }, status: 'loading', title: u.label || u.name, subtitle: u.name,
    fileName: u.name, size: u.size, date: u.uploadedAt, source: 'upload',
  };
}

const COUNT_COLORS = ['bg-warn', 'bg-ok', 'bg-danger', 'bg-line-strong'] as const;

function RecentRow({ e, onOpen, onDelete }: { e: RfpCompareEntry; onOpen: () => void; onDelete: () => void }) {
  const c = e.summary?.counts;
  const parts = c ? [c.changed, c.added, c.removed, c.same] : null;
  const sum = parts ? parts.reduce((a, b) => a + b, 0) : 0;
  const total = e.summary?.reviewTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((e.reviewedCount / total) * 100)) : 0;
  const chip = '!w-[78px] shrink-0 justify-center !px-0 !text-xs !leading-[22px]';
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpen(); } }}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_230px_auto] items-center gap-6 px-5 py-4 transition-colors hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none motion-reduce:transition-none"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-start gap-2.5">
          <SideChip side="prev" className={chip} />
          <span className="min-w-0 pt-px text-sm leading-snug font-medium text-muted [overflow-wrap:anywhere]">{e.prevTitle}</span>
        </div>
        <div className="flex items-start gap-2.5">
          <SideChip side="next" className={chip} />
          <span className="min-w-0 pt-px text-[15px] leading-snug font-semibold text-ink [overflow-wrap:anywhere]">{e.nextTitle}</span>
        </div>
        <div className="flex items-center gap-1 pl-[88px] text-xs text-faint">
          <Clock className="size-3" />{formatDateTime(e.updatedAt)}
        </div>
      </div>
      <div className="space-y-2.5">
        {parts && sum > 0 ? (
          <div>
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              {parts.map((v, i) => v > 0 && <i key={i} className={`block h-full ${COUNT_COLORS[i]}`} style={{ width: `${(v / sum) * 100}%` }} />)}
            </div>
            <div className="mt-1.5 flex gap-3 text-xs text-muted tabular-nums">
              {(['변경', '신규', '삭제'] as const).map((l, i) => (
                <span key={l} className="inline-flex items-center gap-1"><i className={`size-2 rounded-[2px] ${COUNT_COLORS[i]}`} />{l} <b className="font-semibold text-ink">{parts[i]}</b></span>
              ))}
            </div>
          </div>
        ) : <div className="text-xs text-faint">결과를 열면 요약이 표시돼요</div>}
        {total > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
            <span className="shrink-0">검토</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken"><i className={`block h-full rounded-full ${pct === 100 ? 'bg-ok' : 'bg-ink'}`} style={{ width: `${pct}%` }} /></div>
            <span className={`shrink-0 font-semibold ${pct === 100 ? 'text-ok' : 'text-ink'}`}>{e.reviewedCount}/{total}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost" size="icon" className="!size-8 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-danger"
          aria-label="기록 삭제" title="기록 삭제" onClick={(ev) => { ev.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="!size-4" />
        </Button>
        <ChevronRight className="size-5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" />
      </div>
    </div>
  );
}

function UploadRow({ u, onUse, onRename, onDelete }: {
  u: RfpUploadEntry; onUse: (side: Side) => void; onRename: (label: string) => Promise<void>; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(u.label ?? '');
  const done = useRef(false);
  const commit = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save && label.trim() !== (u.label ?? '')) await onRename(label.trim());
  };
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)_110px_110px_auto] items-center gap-4 px-5 py-3.5">
      <ExtBadge name={u.name} small />
      <div className="min-w-0">
        <div className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">{u.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
          {editing ? (
            <input
              autoFocus value={label} maxLength={60} placeholder="라벨 (예: 경쟁사 공유본)"
              onChange={(e) => setLabel(e.target.value)} onBlur={() => void commit(true)}
              onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') void commit(true); if (e.key === 'Escape') void commit(false); }}
              className="h-6 w-48 rounded border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-primary"
            />
          ) : (
            <button type="button" className="inline-flex items-center gap-1 rounded-[5px] bg-sunken px-[7px] text-xs leading-5 font-semibold hover:text-ink" onClick={() => { done.current = false; setLabel(u.label ?? ''); setEditing(true); }} title="라벨 편집">
              {u.label || '라벨 달기'}<Pencil className="size-[11px]" />
            </button>
          )}
          <span>{formatSize(u.size)} · {formatDateTime(u.uploadedAt)} 올림</span>
        </div>
      </div>
      <div><b className="font-bold tabular-nums">{u.itemCount}</b> <span className="text-[13px] text-muted">요구사항</span></div>
      <div><QualityBadge quality={u.quality} /></div>
      <div className="flex gap-1">
        <Button variant="secondary" className="!h-7 !px-2.5" onClick={() => onUse('prev')}>비교 대상에 넣기</Button>
        <Button variant="secondary" className="!h-7 !px-2.5" onClick={() => onUse('next')}>기준에 넣기</Button>
        <Button variant="ghost" size="icon" className="!size-7" aria-label="삭제" onClick={onDelete}><Trash2 className="!size-3.5" /></Button>
      </div>
    </div>
  );
}

export function RfpPage({ query }: { query: { next?: string; prev?: string } }) {
  const [slots, setSlots] = useState<Record<Side, SlotData | null>>({ prev: null, next: null });
  const [picker, setPicker] = useState<Side | null>(null);
  const [uploads, setUploads] = useState<RfpUploadEntry[]>([]);
  const [recent, setRecent] = useState<RfpCompareEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [delCompare, setDelCompare] = useState<RfpCompareEntry | null>(null);
  const [delUpload, setDelUpload] = useState<RfpUploadEntry | null>(null);
  const toast = useToast();
  const tok = useRef<Record<Side, number>>({ prev: 0, next: 0 });
  const indexRef = useRef<IndexEntry[] | null>(null);
  const inited = useRef(false);

  const setSlot = (side: Side, v: SlotData | null) => setSlots((s) => ({ ...s, [side]: v }));

  const loadLists = async () => {
    const [u, r] = await Promise.allSettled([send('rfp/uploads', undefined), send('rfp/compare-list', undefined)]);
    if (u.status === 'fulfilled') setUploads(u.value);
    if (r.status === 'fulfilled') setRecent([...r.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    const bad = u.status === 'rejected' ? u.reason : r.status === 'rejected' ? r.reason : null;
    setListError(bad ? errText(bad) : null);
  };

  const extract = async (side: Side, base: SlotData, force = false) => {
    const t = ++tok.current[side];
    setSlot(side, { ...base, status: 'loading', error: undefined, set: undefined });
    try {
      const set = await send('rfp/extract', { ref: base.ref, force }, { timeoutMs: 100_000 });
      if (tok.current[side] !== t) return;
      setSlot(side, { ...base, status: 'ready', error: undefined, set });
    } catch (e) {
      if (tok.current[side] !== t) return;
      setSlot(side, { ...base, status: 'error', error: errText(e), set: undefined });
    }
  };

  /** 공고 id로 칸을 채운다(rfp 문서 우선). 문서가 없으면 오류 칸. */
  const fillNotice = async (side: Side, noticeId: string) => {
    const t = ++tok.current[side];
    try {
      indexRef.current ??= await send('notice/list', undefined);
      if (tok.current[side] !== t) return;
      const entry = indexRef.current.find((e) => e.noticeId === noticeId);
      if (!entry) throw new Error('수집된 공고를 찾지 못했어요.');
      setSlot(side, { ref: { kind: 'upload', uploadId: '' }, status: 'loading', title: entry.title, source: 'notice', org: orgOf(entry), orgLabel: orgLabel(entry), noticeId, date: entry.collectedAt });
      const cands = await send('rfp/docs', { noticeId }, { timeoutMs: 40_000 });
      if (tok.current[side] !== t) return;
      const cand = defaultCandidate(cands.filter((c) => c.status !== 'unsupported'));
      if (!cand) {
        setSlot(side, { ref: { kind: 'upload', uploadId: '' }, status: 'error', error: '이 공고에는 비교할 수 있는 첨부 문서가 없어요.', title: entry.title, source: 'notice', org: orgOf(entry), orgLabel: orgLabel(entry), noticeId, date: entry.collectedAt, candidates: cands });
        return;
      }
      await extract(side, noticeSlot(entry, cands, cand));
    } catch (e) {
      if (tok.current[side] !== t) return;
      setSlot(side, { ref: { kind: 'upload', uploadId: '' }, status: 'error', error: errText(e), title: '공고', source: 'notice', noticeId });
    }
  };

  const uploadFile = async (side: Side, file: File) => {
    const chk = checkUploadFile(file.name, file.size);
    if (!chk.ok) { toast.show(chk.reason); return; }
    const t = ++tok.current[side];
    const base: SlotData = { ref: { kind: 'upload', uploadId: '' }, status: 'loading', title: file.name, fileName: file.name, size: file.size, source: 'upload' };
    setSlot(side, base);
    try {
      const b64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const res = await send('rfp/upload', { name: file.name, size: file.size, b64 }, { timeoutMs: 130_000 });
      if (tok.current[side] !== t) return;
      setSlot(side, { ...base, ref: { kind: 'upload', uploadId: res.uploadId }, status: 'ready', set: res.set, date: res.set.extractedAt, subtitle: file.name });
      void loadLists();
    } catch (e) {
      if (tok.current[side] !== t) return;
      setSlot(side, { ...base, status: 'error', error: errText(e) });
    }
  };

  useEffect(() => {
    void loadLists();
    if (inited.current) return;
    inited.current = true;
    const { next, prev } = query;
    if (next) void fillNotice('next', next);
    if (prev) void fillNotice('prev', prev);
    if (next && !prev) setPicker('prev');
    else if (prev && !next) setPicker('next');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (side: Side) => { tok.current[side]++; setSlot(side, null); };
  const busy = slots.prev?.status === 'loading' || slots.next?.status === 'loading';
  const swap = () => {
    if (busy) return;
    setSlots((s) => ({ prev: s.next, next: s.prev }));
  };

  const pickerOtherSlot = picker ? slots[other(picker)] : null;
  const pOtherId = pickerOtherSlot?.source === 'notice' ? pickerOtherSlot.noticeId : undefined;
  const pOtherTitle = pickerOtherSlot?.title ?? '';
  const pOtherOrg = pickerOtherSlot?.org ?? '';
  const pickerOther = useMemo<PickerBase | undefined>(
    () => (pOtherId ? { noticeId: pOtherId, title: pOtherTitle, org: pOtherOrg } : undefined),
    [pOtherId, pOtherTitle, pOtherOrg],
  );

  const { prev, next } = slots;
  const ready = prev?.status === 'ready' && next?.status === 'ready' && slotUsable(prev.set) && slotUsable(next.set);
  const same = prev?.status === 'ready' && next?.status === 'ready' && sameRef(prev.ref, next.ref);
  const canCompare = ready && !same && !saving;

  const compare = async () => {
    if (!prev || !next || !canCompare) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await send('rfp/compare-save', {
        session: {
          schemaVersion: 1, id: '', createdAt: '', updatedAt: '',
          prev: { ref: prev.ref, title: prev.title, subtitle: prev.subtitle },
          next: { ref: next.ref, title: next.title, subtitle: next.subtitle },
          overrides: [], reviewed: [],
        },
      });
      window.location.hash = rfpCompareHash(res.id);
    } catch (e) {
      setSaveError(errText(e));
      setSaving(false);
    }
  };

  const hint = same ? null
    : ready && prev?.set && next?.set
      ? `요구사항 ${prev.set.items.length}개 ↔ ${next.set.items.length}개${prev.org && prev.org === next.org ? ` · 같은 기관(${prev.org})` : ''}`
      : prev && !next ? '비교 대상을 고르면 누를 수 있어요'
      : next && !prev ? '기준 문서를 고르면 누를 수 있어요'
      : prev && next ? '두 문서가 모두 읽혀야 누를 수 있어요'
      : '두 문서를 모두 고르면 누를 수 있어요 · HWP·HWPX·DOCX·PDF';

  const renderSlot = (side: Side) => (
    <DocSlot
      side={side}
      data={slots[side]}
      picking={picker === side}
      uploadCount={uploads.length}
      onPick={() => setPicker(side)}
      onFile={(f) => void uploadFile(side, f)}
      onLibrary={() => document.getElementById('rfp-uploads')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onClear={() => clear(side)}
      onRetry={() => { const d = slots[side]; if (d && d.ref.kind === 'upload' && !d.ref.uploadId) { if (d.noticeId) void fillNotice(side, d.noticeId); } else if (d) void extract(side, d, true); }}
      onCandidate={(c) => { const d = slots[side]; if (d) void extract(side, { ...d, ref: c.ref, subtitle: c.name, fileName: c.name }); }}
    />
  );

  return (
    <>
      <div>
        <PageTitle page="rfp" />
        <p className="mt-2 text-muted">비교 대상과 기준 제안요청서의 요구사항을 번호와 내용으로 짝지어, 무엇이 새로 생기고 바뀌고 빠졌는지 보여 줍니다.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_52px_minmax(0,1fr)] items-stretch">
        {renderSlot('prev')}
        <button type="button" onClick={swap} disabled={busy} title="비교 대상·기준 바꾸기" aria-label="비교 대상·기준 바꾸기"
          className="group grid size-10 self-center justify-self-center place-items-center rounded-full border border-line-strong bg-surface text-muted shadow-btn hover:text-ink disabled:opacity-40">
          <ArrowLeftRight className="size-[18px] transition-transform duration-300 group-hover:rotate-180 motion-reduce:transition-none" />
        </button>
        {renderSlot('next')}
      </div>

      {/* 동작 줄: 안내는 왼쪽, 비교 버튼은 두 칸 아래 오른쪽 끝(폼 제출 버튼 자리) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {hint && <span className="mr-auto text-[13px] text-muted">{hint}</span>}
          <Button icon={<ArrowRight />} loading={saving} disabled={!canCompare} onClick={() => void compare()}>변경점 비교하기</Button>
        </div>
        {same && <InlineAlert tone="warn">비교 대상과 기준에 같은 문서가 들어 있어요. 서로 다른 문서를 골라 주세요.</InlineAlert>}
        {saveError && <InlineAlert tone="error">{saveError}</InlineAlert>}
      </div>

      {listError && <InlineAlert tone="error">목록을 불러오지 못했어요. {listError}</InlineAlert>}

      <section className="space-y-2.5 pt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold">최근 비교</h2>
          <span className="text-[13px] text-muted">결과와 검토 표시가 저장돼 있어 이어서 볼 수 있어요</span>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {recent && recent.length === 0 && <EmptyState size="sm" title="아직 비교한 기록이 없어요" />}
          {recent?.map((e) => (
            <RecentRow key={e.id} e={e} onOpen={() => { window.location.hash = rfpCompareHash(e.id); }} onDelete={() => setDelCompare(e)} />
          ))}
          {!recent && <div className="px-5 py-6 text-sm text-muted">불러오는 중…</div>}
        </div>
      </section>

      <section id="rfp-uploads" className="space-y-2.5 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold">올린 문서</h2>
          <span className="text-[13px] text-muted">직접 올린 파일은 여기에 보관돼 다시 쓸 수 있어요</span>
        </div>
        <div className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {uploads.length === 0 && <EmptyState size="sm" title="올린 문서가 없어요" />}
          {uploads.map((u) => (
            <UploadRow
              key={u.uploadId} u={u}
              onUse={(side) => { setPicker(null); tok.current[side]++; void extract(side, uploadSlot(u)); }}
              onRename={async (label) => {
                try {
                  const r = await send('rfp/upload-rename', { uploadId: u.uploadId, label });
                  setUploads((l) => l.map((x) => (x.uploadId === r.uploadId ? r : x)));
                } catch (e) { toast.show(`이름을 바꾸지 못했어요. ${errText(e)}`); }
              }}
              onDelete={() => setDelUpload(u)}
            />
          ))}
        </div>
      </section>

      {picker && (
        <NoticePicker
          side={picker}
          other={pickerOther}
          onClose={() => setPicker(null)}
          onFile={(f) => void uploadFile(picker, f)}
          onSelect={(entry, cands, cand) => { const side = picker; setPicker(null); void extract(side, noticeSlot(entry, cands, cand)); }}
        />
      )}

      <ConfirmDialog
        open={!!delCompare}
        title="이 비교를 삭제할까요?"
        description="저장된 검토 표시도 함께 사라져요."
        onCancel={() => setDelCompare(null)}
        onConfirm={() => {
          const d = delCompare;
          setDelCompare(null);
          if (!d) return;
          send('rfp/compare-delete', { compareId: d.id }).then(() => { setRecent((l) => l?.filter((x) => x.id !== d.id) ?? l); toast.saved('삭제했어요'); }, (e) => toast.show(`삭제하지 못했어요. ${errText(e)}`));
        }}
      />
      <ConfirmDialog
        open={!!delUpload}
        title="올린 문서를 삭제할까요?"
        description="이 문서를 쓰는 저장된 비교는 원문을 다시 열 수 없게 될 수 있어요."
        onCancel={() => setDelUpload(null)}
        onConfirm={() => {
          const d = delUpload;
          setDelUpload(null);
          if (!d) return;
          send('rfp/upload-delete', { uploadId: d.uploadId }).then(() => { setUploads((l) => l.filter((x) => x.uploadId !== d.uploadId)); toast.saved('삭제했어요'); }, (e) => toast.show(`삭제하지 못했어요. ${errText(e)}`));
        }}
      />
      {toast.node}
    </>
  );
}
