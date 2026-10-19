import { Braces, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { variablesFor } from '../../../core/templates/variables';
import type { NoticeKind } from '../../../core/types/notice';
import { Button } from '../../../ui/components';

const GROUPS = ['기본', '일정', '평가', '사전규격', '기타'] as const;

export interface VariablePaletteProps {
  onInsert: (name: string) => void;
  /** 템플릿 종류. 생략하면 입찰공고. */
  kind?: NoticeKind;
}

/** 변수 목록 버튼과 팝업. 팝업 바깥을 누르거나 Esc를 누르면 닫힌다. */
export function VariablePalette({ onInsert, kind = 'bid' }: VariablePaletteProps) {
  const defs = variablesFor(kind);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button variant="secondary" icon={<Braces />} aria-expanded={open} onClick={() => setOpen((v) => !v)}>변수 목록</Button>
      {open && (
        <div role="dialog" aria-label="변수 목록" className="absolute right-0 top-full z-30 mt-2 w-[min(560px,calc(100vw-2rem))] rounded-card border border-line bg-surface p-4 shadow-overlay">
          <div className="mb-1 flex items-start justify-between gap-3">
            <p className="text-xs text-muted">입력칸에서 <kbd className="rounded border border-line-strong px-1 font-mono">{'{'}</kbd> 를 입력하면 변수를 골라 넣을 수 있습니다. 여기서 누르면 마지막으로 선택한 입력칸(제목 옆 값, 문구 포함)에 들어갑니다.</p>
            <button type="button" aria-label="닫기" onClick={() => setOpen(false)} className="-m-1 shrink-0 rounded-ctl p-1 text-muted hover:bg-sunken hover:text-ink [&_svg]:size-4"><X /></button>
          </div>
          <div className="divide-y divide-line">
            {GROUPS.filter((g) => defs.some((d) => d.group === g)).map((g) => (
              <div key={g} className="grid grid-cols-[3rem_1fr] items-start gap-3 py-2.5">
                <span className="pt-1 text-xs font-semibold text-faint">{g}</span>
                <div className="flex flex-wrap gap-1">
                  {defs.filter((d) => d.group === g).map((d) => (
                    <button
                      key={d.name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onInsert(d.name)}
                      className="rounded-ctl border border-transparent bg-select px-2 py-1 text-xs text-ink transition-colors hover:border-line-strong hover:bg-surface"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
