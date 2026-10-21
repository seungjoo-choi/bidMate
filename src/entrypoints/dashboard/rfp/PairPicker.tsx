import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { RequirementItem } from '../../../core/types/rfp';
import { Button } from '../../../ui/components';
import { pickCandidates } from './compare-view-logic';

/** 반대편 미매칭 항목 중 하나를 골라 직접 짝을 맺는다. 이름+본문 유사도 내림차순. */
export function PairPicker({ base, side, pool, onPick, onClose }: {
  base: RequirementItem; side: 'prev' | 'next'; pool: RequirementItem[];
  onPick: (item: RequirementItem) => void; onClose: () => void;
}) {
  const cands = useMemo(() => pickCandidates(base, pool), [base, pool]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sideLabel = side === 'next' ? '기준 문서' : '비교 대상 문서';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="짝 맺기" className="flex max-h-[78vh] w-full max-w-[640px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
        <header className="flex items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">짝 맺기</div>
            <div className="mt-0.5 truncate text-sm text-muted">
              <b className="font-mono font-semibold text-ink">{base.id} {base.name}</b>와 짝지을 {sideLabel} 항목을 고르세요
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="닫기" icon={<X />} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-auto py-1.5">
          {cands.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">짝지을 수 있는 {sideLabel} 항목이 없어요</div>}
          {cands.map(({ item, score }) => (
            <button
              key={item.key} type="button" onClick={() => onPick(item)}
              className="flex w-full items-center gap-4 px-5 py-2.5 text-left hover:bg-sunken"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-snug [overflow-wrap:anywhere]"><span className="mr-1.5 font-mono text-sm font-medium text-muted">{item.id}</span>{item.name}</div>
                {item.definition && <div className="truncate text-[0.8125rem] text-muted">{item.definition}</div>}
              </div>
              <div className="w-[110px] shrink-0">
                <div className="text-right text-xs text-muted">비슷함 {Math.round(score * 100)}%</div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken"><i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(score * 100)}%` }} /></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
