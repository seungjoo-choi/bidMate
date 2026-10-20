import { useState } from 'react';
import type { EvidenceRef } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { ACTION_LABEL, VERDICT_LABEL, suggestionActions, type AiAction } from '../../../ui/review/ai-view';
import { formatItemValue, type CardModel } from '../../../ui/review/view';

export interface AiBlockError { code?: string; message: string }

/** ItemCard 안의 AI 제안. info 톤. 값은 [적용]해야 들어간다. */
export function AiSuggestionBlock({ card, busy, onApply, onDismiss, onOpenText }: {
  card: CardModel;
  busy: boolean;
  onApply: (note?: string) => Promise<AiBlockError | null>;
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

  const run1 = async (a: AiAction) => {
    setError(null);
    setWorking(a);
    const err = a === 'dismiss' ? await onDismiss() : await onApply(note.trim() || undefined);
    setWorking(null);
    if (!err) return;
    setError(err.code === 'AI_STALE' ? '다시 추출되어 이 제안은 적용할 수 없습니다'
      : err.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : `${err.code ?? ''} ${err.message}`.trim());
  };

  return (
    <InlineAlert tone="info">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-semibold">{VERDICT_LABEL[s.verdict]}</span>
          <span className="text-muted">{PROVIDERS[run.provider].label}{run.model ? ` ${run.model}` : ''}</span>
          {applied && <span className="text-accent">적용됨</span>}
        </div>
        {s.value !== null && (
          <div className={card.kind === 'text' ? 'whitespace-pre-wrap break-words' : 'font-mono text-lg font-bold tabular-nums'}>
            {formatItemValue(card.key, s.value)}
          </div>
        )}
        {s.quote && <blockquote className="border-l-2 border-line-strong pl-3 text-ink">{s.quote}</blockquote>}
        {(s.file || s.page != null) && (
          <div className="text-muted">{[s.file, s.page != null ? `${s.page}쪽` : ''].filter(Boolean).join(', ')}</div>
        )}
        {s.note && <p className="text-muted">AI 메모: {s.note}</p>}
        {s.value !== null && !s.valueInQuote && <p className="text-warn">근거 문장에 값이 보이지 않음</p>}
        {s.evidence && <button type="button" className="text-accent hover:underline" onClick={() => onOpenText(s.evidence!)}>전체 텍스트에서 보기</button>}

        {applies && (
          <div className="space-y-2 pt-1">
            <input className={inputClass} placeholder="메모 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            <p className="text-xs text-muted">사용자 수정으로 저장됩니다. 되돌리기로 해제할 수 있습니다.</p>
          </div>
        )}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {actions.length > 0 && (
          <div className="flex gap-2">
            {actions.map((a) => (
              <Button key={a} variant={a === 'dismiss' ? 'secondary' : 'primary'} disabled={busy || working !== null} loading={working === a} onClick={() => void run1(a)}>{ACTION_LABEL[a]}</Button>
            ))}
          </div>
        )}
      </div>
    </InlineAlert>
  );
}
