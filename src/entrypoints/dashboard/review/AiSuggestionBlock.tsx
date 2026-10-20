import { useState } from 'react';
import type { EvidenceRef } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { Button, InlineAlert, ProviderIcon } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { ACTION_LABEL, suggestionActions, type AiAction } from '../../../ui/review/ai-view';
import { formatItemValue, type CardModel } from '../../../ui/review/view';

export interface AiBlockError { code?: string; message: string }

const VERDICT_PILL: Record<string, string> = { match: 'AI 확인 일치', differs: '현재 값과 다름', new: '새로 찾음', none: 'AI도 찾지 못함', multi: '조건별로 다름' };
const RELATION_PILL: Record<string, { text: string; cls: string }> = {
  in_candidates: { text: '규칙 후보와 일치', cls: 'border-ok/30 bg-ok-wash text-ok' },
  differs_from_candidates: { text: '규칙 후보와 다름', cls: 'border-warn/30 bg-warn-wash text-warn' },
};
const shorten = (t: string, n = 80): string => (t.length > n ? `${t.slice(0, n)}…` : t);

/** 인용문에서 값 부분을 mark로 강조한다(값이 문자열로 보일 때만). */
function Quote({ text, value }: { text: string; value: unknown }) {
  const v = value === null || value === undefined ? '' : String(value);
  const at = v ? text.indexOf(v) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="rounded-[2px] bg-mark px-0.5 text-ink">{v}</mark>{text.slice(at + v.length)}</>;
}

/** 공백만 다른 같은 문장인가(조건별 행 인용이 대표 인용과 같으면 행에서 생략). */
const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/** AI가 준 원문 표기(환산 전). 환산값과 표기가 같으면 생략. */
function RawNote({ raw, shown }: { raw?: string; shown: string }) {
  if (!raw || sameText(raw, shown)) return null;
  return <span className="text-xs text-muted">원문 {raw}</span>;
}

/** ItemCard 안의 AI 제안. 연보라(AI) 상자. 값은 [적용]해야 들어간다. */
export function AiSuggestionBlock({ card, busy, onApply, onDismiss, onOpenText }: {
  card: CardModel;
  busy: boolean;
  onApply: (note?: string, variantIndex?: number) => Promise<AiBlockError | null>;
  onDismiss: () => Promise<AiBlockError | null>;
  onOpenText: (e: EvidenceRef) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<AiAction | null>(null);
  const info = card.ai;
  if (!info) return null;
  const { suggestion: s, run } = info;
  const actions = suggestionActions(card, s);
  const applies = actions.includes('apply') || actions.includes('confirm');
  const applied = !!s.appliedAt && card.userEdited;

  const variants = s.variants ?? [];
  const [workingVariant, setWorkingVariant] = useState<number | null>(null);
  const run1 = async (a: AiAction, variantIndex?: number) => {
    setError(null);
    setWorking(a);
    setWorkingVariant(variantIndex ?? null);
    const err = a === 'dismiss' ? await onDismiss() : await onApply(note.trim() || undefined, variantIndex);
    setWorking(null);
    setWorkingVariant(null);
    if (!err) return;
    setError(err.code === 'AI_STALE' ? '다시 추출되어 이 제안은 적용할 수 없습니다'
      : err.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : `${err.code ?? ''} ${err.message}`.trim());
  };

  const place = [s.file, s.page != null ? `${s.page}쪽` : ''].filter(Boolean).join(' · ');
  return (
    <div data-ai={run.provider} className="ai-tint space-y-2.5 rounded-card border border-ai-line bg-ai-wash px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ai-ink">
        <ProviderIcon provider={run.provider} size={16} />
        <strong className="font-semibold text-ink">AI 제안</strong>
        <span>{PROVIDERS[run.provider].label}{run.model ? ` ${run.model}` : ''}</span>
        <span className={`rounded-full border px-2 text-xs font-semibold ${s.verdict === 'match' ? 'border-ok/30 bg-ok-wash text-ok' : 'border-ai-line bg-surface text-ai-ink'}`}>{VERDICT_PILL[s.verdict] ?? s.verdict}</span>
        {s.ruleRelation && RELATION_PILL[s.ruleRelation] && (
          <span className={`rounded-full border px-2 text-xs font-semibold ${RELATION_PILL[s.ruleRelation]!.cls}`}>{RELATION_PILL[s.ruleRelation]!.text}</span>
        )}
        {applied && <span className="text-accent">적용됨</span>}
      </div>
      {s.value !== null && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={card.kind === 'text' ? 'break-words whitespace-pre-wrap' : 'text-xl leading-snug font-bold tabular-nums'}>
            {formatItemValue(card.key, s.value)}
          </span>
          <RawNote raw={s.raw} shown={formatItemValue(card.key, s.value)} />
          <span className="text-[0.8125rem] text-muted">{card.label}</span>
        </div>
      )}
      {variants.length > 0 && (
        <ul className="space-y-2">
          {variants.map((v, i) => (
            <li key={i} className="space-y-1 rounded-ctl border border-ai-line bg-surface px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[0.8125rem] font-semibold text-ai-ink">{v.condition || `조건 ${i + 1}`}</span>
                <span className={card.kind === 'text' ? 'break-words whitespace-pre-wrap' : 'font-bold tabular-nums'}>{formatItemValue(card.key, v.value)}</span>
                <RawNote raw={v.raw} shown={formatItemValue(card.key, v.value)} />
                <span className="flex-1" />
                {suggestionActions(card, s).includes('apply') && (
                  <Button variant="secondary" disabled={busy || working !== null} loading={working === 'apply' && workingVariant === i} onClick={() => void run1('apply', i)}>이 값 적용</Button>
                )}
              </div>
              {v.quote && !sameText(v.quote, s.quote) && <p className="text-xs text-muted">{shorten(v.quote)}{v.page != null ? ` (${v.page}쪽)` : ''}</p>}
              {!v.valueInQuote && <p className="text-xs text-warn">근거 문장에 값이 보이지 않음</p>}
            </li>
          ))}
        </ul>
      )}
      {s.quote && (
        <blockquote className="rounded-r-ctl border-l-[3px] border-ai-line bg-surface px-3 py-2 text-ink">
          <Quote text={s.quote} value={s.value} />
          {place && <cite className="mt-1 block text-xs text-muted not-italic">{place}</cite>}
        </blockquote>
      )}
      {s.note && <p className="text-muted">AI 메모: {s.note}</p>}
      {s.value !== null && !s.valueInQuote && <p className="text-warn">근거 문장에 값이 보이지 않음</p>}

      {applies && (
        <div className="space-y-2 pt-1">
          <input className={inputClass} placeholder="메모 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-muted">사용자 수정으로 저장됩니다. 되돌리기로 해제할 수 있습니다.</p>
        </div>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-2">
        {s.evidence && <Button variant="ghost" onClick={() => onOpenText(s.evidence!)}>전체 텍스트에서 보기</Button>}
        <span className="flex-1" />
        {[...actions].filter((a) => !(a === 'apply' && s.value === null)).sort((a, b) => Number(b === 'dismiss') - Number(a === 'dismiss')).map((a) => (
          <Button key={a} variant={a === 'dismiss' ? 'ghost' : 'ai'} disabled={busy || working !== null} loading={working === a} onClick={() => void run1(a)}>{ACTION_LABEL[a]}</Button>
        ))}
      </div>
    </div>
  );
}
