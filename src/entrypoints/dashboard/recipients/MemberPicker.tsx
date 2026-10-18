import { Search } from 'lucide-react';
import { useState } from 'react';
import type { Recipient } from '../../../core/types/recipient';
import { Button, inputClass } from '../../../ui/components';

interface Props {
  /** 아직 이 그룹에 없는 사람 */
  candidates: Recipient[];
  busy: boolean;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
  onNewRecipient: () => void;
}

/** 주소록에서 여러 명을 골라 한 번에 그룹에 넣는다. */
export function MemberPicker({ candidates, busy, onAdd, onClose, onNewRecipient }: Props) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((r) => [r.name, r.email, r.dept ?? ''].some((v) => v.toLowerCase().includes(needle)))
    : candidates;
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="space-y-3 rounded-ctl border border-accent bg-sunken p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">주소록에서 추가</h3>
        <Button variant="ghost" onClick={onClose}>닫기</Button>
      </div>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted">
          주소록의 모든 수신자가 이미 이 그룹에 있습니다.{' '}
          <button type="button" className="font-semibold text-accent underline" onClick={onNewRecipient}>새 수신자 추가</button>
        </p>
      ) : (
        <>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input aria-label="이름, 이메일, 부서로 찾기" placeholder="이름, 이메일, 부서로 찾기" className={`${inputClass} pl-9`} value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-ctl border border-line bg-surface">
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">찾는 수신자가 없습니다.</li>}
            {shown.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunken">
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {r.name}
                      {r.dept && <span className="ml-2 text-xs font-normal text-muted">{r.dept}</span>}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">{r.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-sm font-semibold text-accent underline" onClick={onNewRecipient}>찾는 수신자가 없나요? 새로 추가</button>
            <Button disabled={busy || picked.length === 0} onClick={() => onAdd(picked)}>{picked.length > 0 ? `${picked.length}명 추가` : '추가'}</Button>
          </div>
        </>
      )}
    </div>
  );
}
