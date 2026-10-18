import { Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EvidenceRef } from '../../../core/types/extraction';
import { Button, InlineAlert, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { formatAmountShort } from '../../../ui/review/format';
import { evidenceMeta, type CardModel } from '../../../ui/review/view';

export interface EditError { code?: string; message: string }
export interface ItemCardProps {
  card: CardModel;
  busy: boolean;
  onEdit: (value: unknown | null, note?: string) => Promise<EditError | null>;
  onOpenText: (e: EvidenceRef) => void;
}

const compactText = (t: string) => t.replace(/\s+/g, '');

const BADGE = {
  verified: { tone: 'ok', text: '확인 완료' }, needs_review: { tone: 'warn', text: '확인 필요' }, userEdited: { tone: 'info', text: '직접 수정' },
} as const;

/** 직접 수정 표시. StatusBadge와 같은 모양에 링크색. */
export function EditedMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-accent">
      <span aria-hidden className="size-2 shrink-0 rounded-[1.5px] bg-current" />
      {children}
    </span>
  );
}

/** 긴 글을 lines줄로 줄이고, 넘칠 때만 [더 보기]를 보인다. */
function ClampText({ text, lines, className = '' }: { text: string; lines: 3 | 4; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div>
      <p ref={ref} className={`whitespace-pre-wrap break-words ${className} ${expanded ? '' : lines === 3 ? 'line-clamp-3' : 'line-clamp-4'}`}>{text}</p>
      {(clamped || expanded) && (
        <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '더 보기'}</button>
      )}
    </div>
  );
}

function Value({ card }: { card: CardModel }) {
  if (card.kind === 'text') return <ClampText text={card.valueText} lines={4} />;
  return <div className="font-mono text-xl font-bold tracking-tight tabular-nums">{card.valueText}</div>;
}

function Editor({ card, onEdit, onCancel }: { card: CardModel; onEdit: ItemCardProps['onEdit']; onCancel: () => void }) {
  const initial = card.value;
  const [text, setText] = useState(() => {
    if (initial === null || initial === undefined) return '';
    if (card.kind === 'period') return String(parseInt(String(initial), 10) || '');
    return String(initial);
  });
  const [bool, setBool] = useState(typeof initial === 'boolean' ? initial : false);
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const build = (): { value: unknown } | { error: string } => {
    if (card.kind === 'bool') return { value: bool };
    if (card.kind === 'text') return text.trim() ? { value: text } : { error: '내용을 입력해 주세요.' };
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return { error: '숫자를 입력해 주세요.' };
    if (card.kind === 'score') return n >= 0 && n <= 1000 ? { value: n } : { error: '0~1000 사이 값을 입력해 주세요.' };
    if (card.kind === 'period') return Number.isInteger(n) && n >= 1 && n <= 99 ? { value: `${n}년` } : { error: '1~99 사이 정수를 입력해 주세요.' };
    return Number.isInteger(n) && n >= 0 ? { value: n } : { error: '0 이상의 정수(원)를 입력해 주세요.' };
  };

  const save = async () => {
    if (saving) return;
    setFieldError(null); setAlert(null);
    const r = build();
    if ('error' in r) { setFieldError(r.error); return; }
    setSaving(true);
    const err = await onEdit(r.value, note.trim() || undefined);
    setSaving(false);
    if (!err) return;
    if (err.code === 'JOB_ALREADY_RUNNING') setAlert('이 공고는 다른 작업이 진행 중입니다');
    else if (err.code === 'INVALID_VALUE') setFieldError(err.message);
    else setAlert(`${err.code ?? ''} ${err.message}`.trim());
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    else if (e.key === 'Enter' && card.kind !== 'text' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); }
  };

  const amount = Number(text);
  return (
    <div className="space-y-3 rounded-ctl border border-line bg-sunken inset-shadow-sunken p-4" onKeyDown={onKey}>
      <div>
        {card.kind === 'bool' ? (
          <div className="inline-flex overflow-hidden rounded-ctl border border-line-strong" role="group">
            {[false, true].map((b) => (
              <button type="button" key={String(b)} aria-pressed={bool === b} onClick={() => setBool(b)} className={`h-[38px] px-4 text-sm font-medium transition-colors not-first:border-l not-first:border-line-strong motion-reduce:transition-none ${bool === b ? 'bg-btn text-btn-ink' : 'bg-surface text-muted hover:bg-sunken hover:text-ink'}`}>{b ? '적용' : '미적용'}</button>
            ))}
          </div>
        ) : card.kind === 'text' ? (
          <textarea autoFocus rows={4} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        ) : (
          <div className="flex items-center gap-2">
            <input autoFocus type="number" min={0} max={card.kind === 'score' ? 1000 : undefined} className={`${inputClass} !w-48`} value={text} onChange={(e) => setText(e.target.value)} />
            {card.kind === 'period' && <span>년</span>}
            {card.kind === 'amount' && <span className="text-muted">원 {text.trim() !== '' && Number.isFinite(amount) && amount >= 0 ? `≈ ${formatAmountShort(amount)}` : ''}</span>}
          </div>
        )}
        {fieldError && <p className="mt-1 text-xs text-danger">{fieldError}</p>}
      </div>
      <input className={inputClass} placeholder="메모 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
      <div className="flex gap-2">
        <Button loading={saving} onClick={() => void save()}>저장</Button>
        <Button variant="secondary" onClick={onCancel}>취소</Button>
      </div>
    </div>
  );
}

export function ItemCard({ card, busy, onEdit, onOpenText }: ItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const badge = BADGE[card.badge];

  const act = async (value: unknown | null) => {
    setAlert(null);
    const err = await onEdit(value);
    if (err) setAlert(err.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : `${err.code ?? ''} ${err.message}`.trim());
    return err;
  };

  const attn = card.badge === 'needs_review';
  return (
    <section className="grid grid-cols-[220px_minmax(0,1fr)]">
      <div className={`space-y-2 border-r border-line px-6 py-5 ${attn ? 'bg-warn-wash' : ''}`}>
        <h3 className="text-base leading-snug font-semibold">{card.label}</h3>
        <div>
          {card.badge === 'userEdited'
            ? <EditedMark>{badge.text}</EditedMark>
            : <StatusBadge status={badge.tone as 'ok' | 'warn'}>{badge.text}</StatusBadge>}
        </div>
        {card.reason && <p className="text-sm text-muted">{card.reason}</p>}
      </div>

      <div className="min-w-0 space-y-4 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1"><Value card={card} /></div>
          <div className="-my-1.5 -mr-3 flex shrink-0 gap-1">
            {card.userEdited && (
              <Button variant="ghost" disabled={busy} icon={<RotateCcw />} onClick={() => void act(null)}>자동 결과로 되돌리기</Button>
            )}
            {!editing && <Button variant="ghost" disabled={busy} icon={<Pencil />} onClick={() => setEditing(true)}>직접 수정</Button>}
          </div>
        </div>
        {card.note && <p className="text-sm text-muted">메모: {card.note}</p>}

        {card.evidence && (
          <div className="space-y-1.5 text-sm">
            <div className="text-muted">{evidenceMeta(card.evidence)}</div>
            <blockquote className="border-l-2 border-line-strong pl-3 text-ink">{card.evidence.evidence}</blockquote>
            {card.evidence.context && compactText(card.evidence.context) !== compactText(card.evidence.evidence) && <p className="text-muted">{card.evidence.context}</p>}
            <button className="text-accent hover:underline" onClick={() => onOpenText(card.evidence!)}>전체 텍스트에서 보기</button>
          </div>
        )}

        {card.candidates.length >= 2 && (
          <div className="space-y-2">
            <div className="text-sm text-muted">후보 {card.candidates.length}개, 하나를 골라 확정하세요</div>
            {card.candidates.map((c, i) => (
              <div key={i} className={`flex items-start gap-3 rounded-ctl border px-4 py-3 ${picked === i ? 'border-ink' : 'border-line'}`}>
                <input type="radio" name={`cand-${card.key}`} aria-label={`후보 ${i + 1}`} className="mt-1 accent-current" checked={picked === i} onChange={() => setPicked(i)} />
                <div className="min-w-0 flex-1">
                  <div className="cursor-pointer" onClick={() => setPicked(i)}>
                    {card.kind === 'text'
                      ? <ClampText text={c.valueText} lines={3} />
                      : <span className="font-mono text-lg font-bold tabular-nums">{c.valueText}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-muted">
                    <span>{c.sourceText}</span>
                    <button type="button" className="text-accent hover:underline" onClick={() => onOpenText(c.evidence)}>전체 텍스트에서 보기</button>
                  </div>
                </div>
              </div>
            ))}
            <Button disabled={busy} onClick={() => void act(card.candidates[picked]?.value ?? null)}>이 값으로 확정</Button>
          </div>
        )}

        {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
        {editing && (
          <Editor
            card={card}
            onCancel={() => setEditing(false)}
            onEdit={async (v, note) => {
              const err = await onEdit(v, note);
              if (!err) setEditing(false);
              return err;
            }}
          />
        )}
      </div>
    </section>
  );
}
