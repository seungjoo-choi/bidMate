import { AlertTriangle, Check, ChevronDown, Eye, FileText, List, Loader2, Search, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RequirementSet, RfpDocCandidate, RfpDocRef } from '../../../core/types/rfp';
import { send } from '../../../messaging/bus';
import { Button } from '../../../ui/components';
import { formatDate } from '../../../ui/review/format';
import { TextDrawer } from '../review/TextDrawer';
import { extLabel, formatSize, QUALITY_LABEL } from './rfp-page-logic';
import { SideChip } from './SideChip';

export type Side = 'prev' | 'next';

/** 한 칸에 채워진 문서. 제목·부제는 비교 저장 때 스냅샷으로 쓴다. */
export interface SlotData {
  ref: RfpDocRef;
  status: 'loading' | 'ready' | 'error';
  set?: RequirementSet;
  error?: string;
  title: string;
  subtitle?: string;
  source: 'notice' | 'upload';
  org?: string;
  /** 화면에 보이는 기관 문구(수요기관이 다르면 "수요 … · 공고 …") */
  orgLabel?: string;
  noticeId?: string;
  /** 공고면 게시/수집일, 업로드면 올린 날 */
  date?: string;
  fileName?: string;
  size?: number;
  candidates?: RfpDocCandidate[];
}

/**
 * 같은 공고의 다른 첨부로 바꾸기. 파일명이 길어도 자르지 않도록 공용 Select 대신
 * 현재 파일명(줄바꿈) + [다른 첨부] 펼침 목록을 쓴다.
 */
function CandidateList({ candidates, current, onPick }: { candidates: RfpDocCandidate[]; current: number; onPick: (c: RfpDocCandidate) => void }) {
  const [open, setOpen] = useState(false);
  const cur = candidates[current];
  const status = (c: RfpDocCandidate) =>
    c.status === 'unsupported' ? '지원하지 않는 형식' : c.status === 'ready' ? `요구사항 ${c.itemCount ?? 0}개 · 분석됨` : '선택하면 분석해요';
  return (
    <div className="mt-3.5 rounded-md border border-line-strong text-sm">
      <div className="flex items-start gap-2 px-3 py-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{cur?.name ?? '문서를 고르세요'}</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          다른 첨부 {candidates.length - (cur ? 1 : 0)}개 <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div role="radiogroup" aria-label="비교할 문서" className="grid gap-1 border-t border-line p-1.5">
          {candidates.map((c, i) => i === current ? null : (
            <button key={`${c.ref.attachmentId}|${c.ref.innerPath ?? ''}`} type="button" role="radio" aria-checked={false}
              disabled={c.status === 'unsupported'} onClick={() => { setOpen(false); onPick(c); }}
              className="rounded-[5px] px-2.5 py-2 text-left hover:bg-sunken disabled:opacity-40">
              <span className="block leading-snug [overflow-wrap:anywhere]">{c.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                {c.docKind === 'rfp' && <span className="rounded-[5px] bg-sunken px-1.5 leading-5 font-semibold text-muted">제안요청서</span>}
                {status(c)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PREFIX_COLORS =['#2b5cb0', '#4f9a94', '#b8382c', '#a1620a', '#7a5bb5', '#65655f', '#2f7a4f', '#a1a19b'];
const LEGEND_MAX = 6;

const SIDE_TEXT: Record<Side, { tag: string; title: string; hint: string; edge: string }> = {
  prev: { tag: '비교 대상', title: '비교할 과거·유사 사업 제안요청서', hint: '파일을 여기로 끌어다 놓거나 아래에서 고르세요', edge: 'shadow-[var(--shadow-card),inset_0_3px_0_var(--color-line-strong)]' },
  next: { tag: '기준', title: '입찰을 준비 중인 공고의 제안요청서', hint: '파일을 여기로 끌어다 놓거나 아래에서 고르세요', edge: 'shadow-[var(--shadow-card),inset_0_3px_0_var(--color-primary)]' },
};

const SideTag = ({ side }: { side: Side }) => <SideChip side={side} />;

export function ExtBadge({ name, small }: { name: string; small?: boolean }) {
  const raw = extLabel(name);
  const ext = /^[A-Z0-9]{2,5}$/.test(raw) ? raw : '';
  return (
    <div className={`grid shrink-0 place-items-end justify-items-center rounded-[7px] border border-line bg-sunken font-bold ${ext === 'PDF' ? 'text-danger' : 'text-muted'} ${small ? 'h-10 w-[34px] pb-[5px] text-[10px]' : 'h-[52px] w-11 pb-[7px] text-[11px]'}`}>
      {ext}
    </div>
  );
}

export function QualityBadge({ quality }: { quality: 'good' | 'partial' | 'none' }) {
  const cls = quality === 'good' ? 'text-ok' : quality === 'partial' ? 'text-warn' : 'text-faint';
  return (
    <span className={`inline-flex items-center gap-[5px] text-[13px] font-semibold ${cls}`}>
      {quality === 'good' ? <Check className="size-3.5 stroke-[2.6]" /> : <AlertTriangle className="size-3.5" />}
      {QUALITY_LABEL[quality]}
    </span>
  );
}


function Extracting({ data }: { data: SlotData }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setStep(1), 2500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 py-6">
      <div className="flex items-center gap-2.5 text-[15px] font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        {step === 0 ? '파일 읽는 중…' : '요구사항 표 찾는 중…'}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className={step === 0 ? 'text-ink' : 'text-ok'}>파일 읽기</span>
        <span className="text-faint">→</span>
        <span className={step === 1 ? 'text-ink' : 'text-faint'}>요구사항 표 찾기</span>
      </div>
      <div className="h-2.5 w-[70%] animate-pulse rounded-full bg-sunken motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">{data.title}</span>
    </div>
  );
}

export interface DocSlotProps {
  side: Side;
  data: SlotData | null;
  /** 이 칸의 공고 고르기 모달이 열려 있음 */
  picking: boolean;
  uploadCount: number;
  onPick: () => void;
  onFile: (file: File) => void;
  onLibrary: () => void;
  onClear: () => void;
  onRetry: () => void;
  onCandidate: (cand: RfpDocCandidate) => void;
}

export function DocSlot({ side, data, picking, uploadCount, onPick, onFile, onLibrary, onClear, onRetry, onCandidate }: DocSlotProps) {
  const [dragging, setDragging] = useState(false);
  const [showText, setShowText] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = SIDE_TEXT[side];

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
  };
  const fileInput = (
    <input ref={fileRef} type="file" accept=".hwp,.hwpx,.pdf,.docx" className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
  );

  // 빈칸 / 끌어다 놓는 중 / 고르는 중
  if (!data) {
    const cls = dragging ? 'border-2 border-dashed border-primary bg-btn-pri-wash'
      : picking ? 'border-2 border-solid border-primary bg-surface shadow-[0_0_0_4px_var(--color-btn-pri-wash)]'
      : 'border-2 border-dashed border-line-strong';
    return (
      <div className={`relative flex min-h-[300px] flex-col items-center justify-center gap-1 rounded-[14px] px-6 py-[22px] text-center ${cls}`} {...dropProps}>
        <div className="absolute inset-x-6 top-5 flex min-h-7 items-center"><SideTag side={side} /></div>
        <div className={`mb-3 grid size-14 place-items-center rounded-2xl bg-surface shadow-card ${dragging || picking ? 'text-primary' : 'text-muted'}`}>
          {dragging ? <Upload className="size-[26px] stroke-[1.7]" /> : picking ? <Search className="size-[26px] stroke-[1.7]" /> : <FileText className="size-[26px] stroke-[1.7]" />}
        </div>
        <h3 className={`text-[17px] font-semibold ${dragging ? 'text-primary' : ''}`}>
          {dragging ? `여기에 놓으면 ${text.tag}로 올라가요` : picking ? `${text.tag}를 고르는 중…` : text.title}
        </h3>
        {!dragging && <p className="mt-0.5 mb-4 text-sm text-muted">{picking ? '사업명이 같거나 같은 기관의 공고를 위에 모아 뒀어요' : text.hint}</p>}
        {!dragging && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<List />} onClick={onPick}>공고에서 고르기</Button>
            <Button variant="secondary" icon={<Upload />} onClick={() => fileRef.current?.click()}>파일 올리기</Button>
          </div>
        )}
        {!dragging && uploadCount > 0 && (
          <button type="button" className="mt-3.5 text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] hover:text-ink" onClick={onLibrary}>
            올린 문서 {uploadCount}개에서 고르기
          </button>
        )}
        {fileInput}
      </div>
    );
  }

  const set = data.set;
  const total = set ? set.prefixes.reduce((a, p) => a + p.count, 0) : 0;
  const prefixes = set ? [...set.prefixes].sort((a, b) => b.count - a.count) : [];
  const candIndex = (data.candidates ?? []).findIndex((c) => c.ref.attachmentId === (data.ref.kind === 'notice' ? data.ref.attachmentId : '') && (c.ref.innerPath ?? '') === (data.ref.kind === 'notice' ? (data.ref.innerPath ?? '') : ''));

  return (
    <div className={`relative flex min-h-[300px] flex-col rounded-[14px] border border-line bg-surface px-6 py-[22px] ${text.edge} ${dragging ? 'border-primary bg-btn-pri-wash' : ''}`} {...dropProps}>
      <div className="flex min-h-7 items-center justify-between">
        <SideTag side={side} />
        <Button variant="ghost" icon={<X />} className="!h-7 !px-2.5" onClick={onClear}>비우기</Button>
      </div>
      <div className="mt-3.5 flex gap-3.5">
        <ExtBadge name={data.fileName ?? data.title} />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] leading-snug font-semibold tracking-tight break-words">{data.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1 rounded-[5px] bg-sunken px-[7px] text-xs leading-5 font-semibold">
              {data.source === 'notice' ? <List className="size-[11px]" /> : <Upload className="size-[11px]" />}
              {data.source === 'notice' ? '수집 공고' : '올린 파일'}
            </span>
            {(data.orgLabel ?? data.org) && <span>{data.orgLabel ?? data.org}</span>}
            {data.source === 'upload' && data.size !== undefined && <span>{formatSize(data.size)}</span>}
            {data.date && <span className="before:mr-2 before:text-faint before:content-['·']">{data.source === 'upload' ? `${formatDate(data.date)} 올림` : `${formatDate(data.date)} 게시`}</span>}
          </div>
        </div>
      </div>

      {data.source === 'notice' && (data.candidates?.length ?? 0) >= 2 && (
        <CandidateList candidates={data.candidates!} current={candIndex} onPick={onCandidate} />
      )}
      {data.source === 'notice' && data.subtitle && (data.candidates?.length ?? 0) < 2 && (
        <div className="mt-3 flex min-h-9 items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-sm">
          <FileText className="size-4 shrink-0 text-faint" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{data.fileName ?? data.subtitle}</span>
        </div>
      )}

      {data.status === 'loading' && <Extracting data={data} />}

      {data.status === 'error' && (
        <>
          <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-danger-wash px-3 py-2.5 text-[13px] leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div><b className="block">문서를 읽지 못했어요</b>{data.error}</div>
          </div>
          <div className="mt-auto flex gap-1.5 border-t border-line pt-3.5">
            <Button variant="secondary" onClick={onPick}>다른 문서 고르기</Button>
            {data.source === 'upload' && data.ref.kind === 'upload' && !data.ref.uploadId
              ? <Button variant="ghost" onClick={() => fileRef.current?.click()}>파일 다시 고르기</Button>
              : <Button variant="ghost" onClick={onRetry}>다시 시도</Button>}
          </div>
        </>
      )}

      {data.status === 'ready' && set && (
        <>
          {set.warnings.length > 0 && (
            <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-warn-wash px-3 py-2.5 text-[13px] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <div>{set.warnings[0]}</div>
            </div>
          )}
          {set.quality === 'none' && (
            <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2.5 text-[13px] leading-relaxed">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted" />
              <div><b className="block">이 문서에서는 요구사항을 찾지 못했어요</b>요구사항 고유번호(SFR-001 등)가 있는 표가 없어요. 같은 공고의 다른 문서를 골라 보세요.</div>
            </div>
          )}
          <div className="mt-auto pt-[18px]">
            <div className="flex items-baseline gap-2">
              <b className="text-[30px] font-bold tracking-tight tabular-nums">{set.items.length}</b>
              <span className="text-sm text-muted">요구사항</span>
              <span className="ml-auto"><QualityBadge quality={set.quality} /></span>
            </div>
            {total > 0 && (
              <>
                <div className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
                  {prefixes.map((p, i) => (
                    <i key={p.prefix} className="block h-full" style={{ width: `${(p.count / total) * 100}%`, background: PREFIX_COLORS[i % PREFIX_COLORS.length] }} title={`${p.prefix} ${p.count}`} />
                  ))}
                </div>
                <div className="mt-[9px] flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {prefixes.slice(0, LEGEND_MAX).map((p, i) => (
                    <span key={p.prefix} className="inline-flex items-center gap-[5px]">
                      <i className="inline-block size-2 rounded-[2px]" style={{ background: PREFIX_COLORS[i % PREFIX_COLORS.length] }} />
                      <span className="font-mono">{p.prefix}</span>
                      <b className="font-semibold text-ink tabular-nums">{p.count}</b>
                    </span>
                  ))}
                  {prefixes.length > LEGEND_MAX && <span className="text-faint">+{prefixes.length - LEGEND_MAX}</span>}
                </div>
              </>
            )}
          </div>
          <div className="mt-4 flex gap-1.5 border-t border-line pt-3.5">
            <Button variant="secondary" icon={<Eye />} onClick={() => setShowText(true)}>원문 텍스트</Button>
          </div>
        </>
      )}
      {/* 다른 화면과 같은 오른쪽 원문 패널(표는 표로 그려 [셀 …] 표시가 보이지 않는다) */}
      {showText && (
        <TextDrawer
          noticeId={data.noticeId ?? ''}
          target={{ textPath: data.set?.source.textPath ?? '', title: `원문 · ${data.fileName ?? data.title}` }}
          load={() => send('rfp/text', { ref: data.ref }, { timeoutMs: 40_000 })}
          onClose={() => setShowText(false)}
        />
      )}
      {fileInput}
    </div>
  );
}
