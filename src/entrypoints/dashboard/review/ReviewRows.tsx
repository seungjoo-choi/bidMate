import { ChevronRight, FileSearch, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NOT_RUN_TEXT, type ReviewLeafKey, type ReviewRowKey } from '../../../core/extraction/review-rows';
import { inputKindOf, parseFieldInput } from '../../../core/model/field-edit';
import type { AiKey } from '../../../core/ai/keys';
import type { AiProvider } from '../../../core/types/ai';
import type { EvidenceRef } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { Button, FormActions, InlineAlert, ProviderIcon } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { formatLeafValue, type ReviewLeaf, type ReviewRow, type RowSummary } from '../../../ui/review/rows';
import { evidenceMeta } from '../../../ui/review/view';
import { AiSuggestionBlock, type AiBlockError } from './AiSuggestionBlock';

export interface EditError { code?: string; message: string }
export type LeafEdit = (key: ReviewLeafKey, value: unknown | null, note?: string, raw?: string) => Promise<EditError | null>;

/** 결정 줄의 작은 버튼. 기본 Button(40px)은 목록 안에서 너무 커서 줄인다. */
const SMALL = '!h-8 !gap-1.5 !px-3 !text-[0.8125rem] [&_svg]:!size-3.5';

const compact = (t: string) => t.replace(/\s+/g, '');

/** AI 제안 중 아직 적용, 무시하지 않은 "다른 값"이 있는가 */
export function aiPending(l: ReviewLeaf): boolean {
  const s = l.ai?.suggestion;
  return !!s && (s.verdict === 'differs' || s.verdict === 'new' || s.verdict === 'multi') && !s.appliedAt && !s.dismissedAt;
}

function aiChip(l: ReviewLeaf): string | null {
  if (!aiPending(l)) return null;
  const s = l.ai!.suggestion;
  if (s.variants && s.variants.length > 0) return `AI 조건별 ${s.variants.length}개`;
  if (s.value === null) return null;
  const v = formatLeafValue(l.kind, s.value);
  return `AI ${v.length > 16 ? `${v.slice(0, 16)}…` : v}`;
}

/** 근거 문장에서 값을 형광펜으로 강조한다(값 문자열이 그대로 보일 때만). */
function Marked({ text, value }: { text: string; value: string }) {
  const at = value && value !== '—' ? text.indexOf(value) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="rounded-[2px] bg-mark px-0.5 text-ink">{value}</mark>{text.slice(at + value.length)}</>;
}

/** 긴 글을 3줄로 줄이고, 넘칠 때만 [더 보기]를 보인다. */
function ClampText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div>
      <p ref={ref} className={`break-words whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
      {(clamped || expanded) && <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '더 보기'}</button>}
    </div>
  );
}

// ── 상단 요약 ─────────────────────────────────────────────

const CELL: Record<string, string> = { needs_review: 'bg-warn', not_run: 'bg-line-strong', user_edited: 'bg-accent', covered: 'bg-ok', not_applicable: 'bg-ok', verified: 'bg-ok' };

export function ReviewSummary({ rows, summary, onJump, actions }: { rows: ReviewRow[]; summary: RowSummary; onJump: () => void; actions?: React.ReactNode }) {
  const doneRows = rows.filter((r) => r.state !== 'needs_review' && r.state !== 'not_run').length;
  const notRunRows = rows.filter((r) => r.state === 'not_run').length;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
      <div className="min-w-0 flex-1 basis-72 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
          {summary.pending > 0
            ? <span className="text-xl font-bold text-warn">확인 필요 {summary.pending}개</span>
            : <span className="text-xl font-bold text-ok">모두 확인됨</span>}
          <span className="text-sm text-muted">
            {rows.length}개 항목 중 {doneRows}개 확인됨{notRunRows > 0 ? `, ${notRunRows}개 문서 분석 전` : ''}
          </span>
        </div>
        <div className="flex h-2 gap-[3px]" aria-hidden>
          {rows.map((r) => <span key={r.key} title={r.label} className={`flex-1 rounded-[2px] ${CELL[r.state] ?? 'bg-ok'}`} />)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {summary.pending > 0 && <Button variant="secondary" className={SMALL} onClick={onJump}>확인 필요 항목으로 이동 ↓</Button>}
        {actions}
      </div>
    </div>
  );
}

// ── 직접 수정 입력 ─────────────────────────────────────────

function LeafEditor({ leaf, onSave, onCancel }: { leaf: ReviewLeaf; onSave: (value: unknown, note?: string, raw?: string) => Promise<EditError | null>; onCancel: () => void }) {
  const kind = inputKindOf(leaf.key);
  const initial = leaf.value;
  const [text, setText] = useState(() => {
    if (initial === null || initial === undefined || typeof initial === 'boolean') return kind === 'bool_joint' ? (leaf.raw ?? '') : '';
    if (kind === 'period') { const n = parseInt(String(initial), 10); return Number.isNaN(n) ? '' : String(n); }
    if (kind === 'datetime') return formatLeafValue('datetime', initial) === '—' ? '' : String(initial).replace('T', ' ').slice(0, 16);
    return String(initial);
  });
  const [flag, setFlag] = useState<boolean | undefined>(typeof initial === 'boolean' ? initial : undefined);
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setFieldError(null); setAlert(null);
    const r = kind === 'bool_apply'
      ? (flag === undefined ? { ok: false as const, message: '적용 또는 미적용을 고르세요' } : { ok: true as const, value: flag })
      : parseFieldInput(kind, text, kind === 'bool_joint' ? (flag === undefined ? {} : { joint: flag }) : undefined);
    if (!r.ok) { setFieldError(r.message); return; }
    setSaving(true);
    const err = await onSave(r.value, note.trim() || undefined, 'raw' in r ? r.raw : undefined);
    setSaving(false);
    if (!err) return;
    if (err.code === 'JOB_ALREADY_RUNNING') setAlert('이 공고는 다른 작업이 진행 중입니다');
    else if (err.code === 'INVALID_VALUE') setFieldError(err.message);
    else setAlert(`${err.code ?? ''} ${err.message}`.trim());
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    else if (e.key === 'Enter' && kind !== 'longtext' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void save(); }
  };
  const toggle = (labels: [string, string]) => (
    <div className="inline-flex overflow-hidden rounded-ctl border border-line-strong" role="group">
      {[true, false].map((b) => (
        <button type="button" key={String(b)} aria-pressed={flag === b} onClick={() => setFlag(b)} className={`h-[38px] px-4 text-sm font-medium transition-colors not-first:border-l not-first:border-line-strong motion-reduce:transition-none ${flag === b ? 'bg-btn text-btn-ink' : 'bg-surface text-muted hover:bg-sunken hover:text-ink'}`}>{b ? labels[0] : labels[1]}</button>
      ))}
    </div>
  );
  const placeholder: Record<string, string> = { datetime: '예: 2026-10-21 18:00', amount: '원 단위 숫자', amount_short: '원 단위 숫자', score: '점수', period: '년 수(예: 3)' };

  return (
    <div className="space-y-3 rounded-ctl border border-line bg-sunken p-4 inset-shadow-sunken" onKeyDown={onKey}>
      <div>
        {kind === 'bool_apply' ? toggle(['적용', '미적용'])
          : kind === 'bool_joint' ? (
            <div className="flex flex-wrap items-center gap-2">
              {toggle(['허용', '불허'])}
              <input className={`${inputClass} !w-56`} placeholder="방식(예: 공동이행, 선택)" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            </div>
          ) : kind === 'longtext' || (kind === 'text' && leaf.key === 'performanceCondition') ? (
            <textarea autoFocus rows={4} className={inputClass} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
          ) : (
            <div className="flex items-center gap-2">
              <input autoFocus className={`${inputClass} ${kind === 'text' ? '' : '!w-56'}`} placeholder={placeholder[kind] ?? `${leaf.label} 값`} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
              {kind === 'period' && <span>년</span>}
            </div>
          )}
        {fieldError && <p className="mt-1 text-xs text-danger">{fieldError}</p>}
      </div>
      <input className={inputClass} placeholder="메모 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
      <FormActions>
        <Button variant="secondary" onClick={onCancel}>취소</Button>
        <Button loading={saving} onClick={() => void save()}>저장</Button>
      </FormActions>
    </div>
  );
}

// ── 잎(값 하나) 패널 ───────────────────────────────────────

export interface LeafActions {
  busy: boolean;
  aiDisabled: boolean;
  aiProvider: AiProvider;
  isFinding: (key: AiKey) => boolean;
  onAiFind: (key: AiKey) => void;
  onEdit: LeafEdit;
  onOpenText: (e: EvidenceRef) => void;
  onAiApply: (key: AiKey) => (runId: string, note?: string, variantIndex?: number) => Promise<AiBlockError | null>;
  onAiDismiss: (key: AiKey) => (runId: string) => Promise<AiBlockError | null>;
}

function LeafPanel({ leaf, titled, a }: { leaf: ReviewLeaf; titled: boolean; a: LeafActions }) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const hasAi = !!leaf.ai || !!leaf.aiOthers?.length;
  const finding = a.isFinding(leaf.key);
  const empty = leaf.value === null || leaf.value === undefined;
  const pending = leaf.state === 'needs_review';

  // raw: 원문 표기(공동수급 방식 등). 확정할 때 지우지 않도록 같이 보낸다
  const act = async (value: unknown | null, raw?: string) => {
    setAlert(null); setWorking(true);
    const err = await a.onEdit(leaf.key, value, undefined, raw);
    setWorking(false);
    if (err) setAlert(err.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : `${err.code ?? ''} ${err.message}`.trim());
  };

  const aiFindBtn = (primary: boolean) => leaf.aiFindable && (finding ? (
    <span data-ai={a.aiProvider} className="inline-flex h-8 items-center gap-1.5 rounded-btn bg-ai-wash px-3 text-[0.8125rem] whitespace-nowrap text-ai-ink">
      <span className="inline-flex animate-spin motion-reduce:animate-none"><ProviderIcon provider={a.aiProvider} size={14} /></span>
      {PROVIDERS[a.aiProvider].label}가 찾는 중…
    </span>
  ) : (
    <Button variant={primary ? 'ai' : 'secondary'} className={SMALL} disabled={a.busy || a.aiDisabled} icon={<ProviderIcon provider={a.aiProvider} size={14} />} onClick={() => a.onAiFind(leaf.key)}>AI로 찾기</Button>
  ));
  const editBtn = (label = '직접 수정') => <Button variant="secondary" className={SMALL} disabled={a.busy} icon={<Pencil />} onClick={() => setEditing(true)}>{label}</Button>;

  // 결정 줄: 왼쪽은 보조 동작, 오른쪽 끝은 이 상태에서 할 주 동작
  let left: React.ReactNode = null;
  let right: React.ReactNode = null;
  if (leaf.state === 'not_run') {
    // 문서 분석 전에는 미리 입력할 수 있다. 이전 버전 추출이면 다시 추출이 먼저라 버튼을 두지 않는다
    right = leaf.reason === NOT_RUN_TEXT ? null : editBtn('직접 입력');
  } else if (pending && leaf.candidates.length >= 2) {
    left = <>{aiFindBtn(false)}{editBtn()}</>;
    right = <Button className={SMALL} disabled={a.busy} loading={working} onClick={() => void act(leaf.candidates[picked]?.value ?? null)}>이 값으로 확정</Button>;
  } else if (pending && leaf.confirmable) {
    left = <>{aiFindBtn(false)}{editBtn()}</>;
    right = <Button className={SMALL} disabled={a.busy} loading={working} onClick={() => void act(leaf.value, leaf.raw)}>이 값이 맞음</Button>;
  } else if (pending) {
    left = editBtn('직접 입력');
    right = aiFindBtn(true) || null;
  } else if (leaf.state === 'user_edited') {
    right = <><Button variant="secondary" className={SMALL} disabled={a.busy} icon={<RotateCcw />} onClick={() => void act(null)}>자동 결과로 되돌리기</Button>{editBtn()}</>;
  } else {
    right = editBtn();
  }

  const ev = leaf.evidence;
  // 결정할 것이 없는 상태(확인 완료 등)는 버튼을 내용 옆에 붙여 줄을 따로 쓰지 않는다
  const inline = !editing && !left;
  const body = (
    <>
      {titled && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 className="text-sm font-semibold">{leaf.label}</h4>
          <span className={`text-base font-bold tabular-nums ${empty ? 'font-medium text-faint' : ''}`}>{empty ? '값 없음' : leaf.valueText}</span>
          <LeafStateText leaf={leaf} />
        </div>
      )}
      {leaf.reason && <p className={`text-sm font-medium ${pending ? 'text-warn' : 'text-muted'}`}>{leaf.reason}</p>}
      {leaf.kind === 'text' && !empty && !titled && leaf.valueText.length > LONG_TEXT && <div className="text-sm"><ClampText text={leaf.valueText} /></div>}
      {leaf.note && <p className="text-sm text-muted">메모: {leaf.note}</p>}
      {leaf.autoValueText && <p className="text-sm text-muted">자동 결과: {leaf.autoValueText}</p>}

      {ev && leaf.candidates.length < 2 && (
        <div className="space-y-1 text-sm">
          <div className="text-xs text-muted">{evidenceMeta(ev)}</div>
          <blockquote className="border-l-2 border-line-strong pl-3"><Marked text={ev.evidence} value={leaf.valueText} /></blockquote>
          {ev.context && compact(ev.context) !== compact(ev.evidence) && <p className="text-muted">{ev.context}</p>}
          <div><Button variant="primary" className="mt-1" icon={<FileSearch />} onClick={() => a.onOpenText(ev)}>원문에서 확인</Button></div>
        </div>
      )}
      {!ev && leaf.evidenceText && (
        <div className="space-y-1 text-sm">
          <div className="text-xs text-muted">{leaf.sourceText}</div>
          <blockquote className="border-l-2 border-line-strong pl-3"><Marked text={leaf.evidenceText} value={leaf.valueText} /></blockquote>
        </div>
      )}
      {empty && leaf.raw && <p className="text-sm"><span className="text-muted">원문 표기: </span>{leaf.raw}</p>}

      {pending && leaf.candidates.length >= 2 && (
        <div className="space-y-2">
          <div className="text-sm text-muted">후보 {leaf.candidates.length}개, 맞는 값을 고르세요</div>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={`${leaf.label} 후보`}>
            {leaf.candidates.map((c, i) => (
              <label key={i} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-ctl border px-4 py-3 ${picked === i ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-sunken'}`}>
                <input type="radio" name={`cand-${leaf.key}`} className="mt-1 accent-current" checked={picked === i} onChange={() => setPicked(i)} />
                <div className="min-w-0 flex-1 space-y-1">
                  {leaf.kind === 'text' ? <div className="text-sm"><ClampText text={c.valueText} /></div> : <div className="text-lg font-bold tabular-nums">{c.valueText}</div>}
                  <div className="text-xs text-muted">{c.sourceText}</div>
                  {c.evidence && <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={(e) => { e.preventDefault(); a.onOpenText(c.evidence!); }}><FileSearch className="size-3.5" />원문에서 확인</button>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {hasAi && (
        <AiSuggestionBlock leaf={leaf} busy={a.busy} onApply={a.onAiApply(leaf.key)} onDismiss={a.onAiDismiss(leaf.key)} onOpenText={a.onOpenText} />
      )}

      {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
    </>
  );
  if (inline) {
    return (
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-3">
          {body}
          {!titled && !(leaf.kind === 'text' && leaf.valueText.length > LONG_TEXT) && !(empty && leaf.raw) && !leaf.reason && !ev && !leaf.evidenceText && !leaf.note && !leaf.autoValueText && !hasAi && (
            <p className="pt-1.5 text-sm text-muted">{leaf.sourceText ? `${leaf.sourceText}에서 가져온 값입니다` : '자동으로 채운 값입니다'}</p>
          )}
        </div>
        {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {body}
      {editing ? (
        <LeafEditor
          leaf={leaf}
          onCancel={() => setEditing(false)}
          onSave={async (v, note, raw) => {
            const err = await a.onEdit(leaf.key, v, note, raw);
            if (!err) setEditing(false);
            return err;
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {left}
          <span className="flex-1" />
          {right}
        </div>
      )}
    </div>
  );
}

/** 행 머리에서 잘릴 만한 길이일 때만 펼친 칸에 전문을 다시 보여 준다. */
const LONG_TEXT = 60;

// ── 상태 표시 ─────────────────────────────────────────────

function LeafStateText({ leaf }: { leaf: ReviewLeaf }) {
  if (leaf.state === 'needs_review') return <span className="text-xs font-semibold text-warn">확인 필요</span>;
  if (aiPending(leaf)) return <span className="text-xs font-semibold text-ai-ink">AI 다른 값</span>;
  if (leaf.state === 'user_edited') return leaf.editedOrigin === 'confirm'
    ? <span className="text-xs font-semibold text-ok">확인함</span>
    : leaf.editedOrigin === 'ai'
      ? <span className="text-xs font-semibold text-ai-ink">AI 적용</span>
      : <span className="text-xs font-semibold text-accent">직접 수정</span>;
  if (leaf.state === 'not_run') return <span className="text-xs text-muted">분석 전</span>;
  if (leaf.state === 'covered') return <span className="text-xs text-muted">충족</span>;
  if (leaf.state === 'not_applicable') return <span className="text-xs text-muted">해당 없음</span>;
  return <span className="text-xs font-semibold text-ok">확인 완료</span>;
}

type Tone = 'warn' | 'ai' | 'ok' | 'edit' | 'idle';
function rowTone(row: ReviewRow): { tone: Tone; text: string } {
  const leaves = [row.head, ...row.sub];
  if (row.state === 'needs_review') return { tone: 'warn', text: row.sub.length > 0 ? `확인 필요 ${row.pendingCount}` : '확인 필요' };
  if (leaves.some(aiPending)) return { tone: 'ai', text: 'AI 다른 값' };
  if (row.state === 'not_run') return { tone: 'idle', text: '분석 전' };
  if (row.state === 'user_edited') {
    const edited = leaves.filter((l) => l.state === 'user_edited');
    if (edited.every((l) => l.editedOrigin === 'confirm')) return { tone: 'ok', text: '확인함' };
    if (edited.every((l) => l.editedOrigin === 'ai' || l.editedOrigin === 'confirm')) return { tone: 'edit', text: 'AI 적용' };
    return { tone: 'edit', text: '직접 수정' };
  }
  if (row.state === 'covered') return { tone: 'idle', text: '충족' };
  if (row.state === 'not_applicable') return { tone: 'idle', text: '해당 없음' };
  return { tone: 'ok', text: '확인 완료' };
}

const ICON: Record<Tone, string> = {
  warn: 'bg-warn text-surface', ai: 'bg-ai-ink text-surface', ok: 'bg-ok-wash text-ok', edit: 'bg-info-wash text-accent', idle: 'bg-sunken text-faint',
};
const GLYPH: Record<Tone, string> = { warn: '!', ai: 'AI', ok: '✓', edit: '✎', idle: '–' };
const TEXT: Record<Tone, string> = { warn: 'text-warn', ai: 'text-ai-ink', ok: 'text-ok', edit: 'text-accent', idle: 'text-muted' };

// ── 행 ───────────────────────────────────────────────────

export function ReviewRowItem({ row, open, onToggle, a }: { row: ReviewRow; open: boolean; onToggle: () => void; a: LeafActions }) {
  const { tone, text } = rowTone(row);
  const head = row.head;
  const empty = head.value === null || head.value === undefined;
  const chip = aiChip(head);
  const stripe = tone === 'warn' ? 'shadow-[inset_4px_0_0_var(--color-warn)]' : tone === 'ai' ? 'shadow-[inset_4px_0_0_var(--color-ai-ink)]' : '';
  const headBg = tone === 'warn' ? 'bg-warn-wash' : tone === 'ai' ? 'bg-ai-wash' : 'hover:bg-sunken';
  const provider = head.ai?.run.provider;
  return (
    <section id={`review-row-${row.key}`} className={`scroll-mt-4 ${stripe}`} {...(tone === 'ai' && provider ? { 'data-ai': provider } : {})}>
      <button
        type="button" aria-expanded={open} onClick={onToggle}
        className={`grid w-full grid-cols-[24px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-0.5 px-5 py-3 text-left md:grid-cols-[24px_168px_minmax(0,1fr)_200px_84px_16px] ${headBg}`}
      >
        <span aria-hidden className={`row-span-3 grid size-5 place-items-center self-start rounded-full text-[0.6875rem] font-bold md:row-span-1 md:self-center ${ICON[tone]}`}>{GLYPH[tone]}</span>
        <span className="text-sm font-semibold">{row.label}</span>
        <span className={`col-start-2 min-w-0 truncate md:col-start-auto ${empty ? 'text-sm text-faint' : head.kind === 'text' ? 'text-sm' : 'text-base font-bold tabular-nums'}`}>
          {empty ? (row.state === 'not_run' ? '—' : '값 없음') : head.valueText}
          {chip && <span className="ml-2 rounded-full border border-ai-line bg-surface px-2 py-px align-[2px] text-xs font-semibold text-ai-ink">{chip}</span>}
        </span>
        <span className="col-start-2 truncate text-xs text-muted md:col-start-auto">{head.sourceText}</span>
        <span className={`hidden text-xs font-semibold md:block ${TEXT[tone]}`}>{text}</span>
        <ChevronRight aria-hidden className={`col-start-3 row-span-3 row-start-1 size-4 self-center text-faint transition-transform motion-reduce:transition-none md:col-start-auto md:row-span-1 md:row-start-auto ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="space-y-5 px-5 pt-1 pb-5 md:pl-[56px]">
          <LeafPanel leaf={head} titled={row.sub.length > 0} a={a} />
          {row.sub.map((l) => (
            <div key={l.key} className="border-t border-dashed border-line pt-4"><LeafPanel leaf={l} titled a={a} /></div>
          ))}
        </div>
      )}
    </section>
  );
}

export type OpenOverride = Partial<Record<ReviewRowKey, boolean>>;
