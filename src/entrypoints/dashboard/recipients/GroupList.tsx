import { BookUser, Plus, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Group } from '../../../core/types/recipient';
import { Button, EmptyState, FormActions, inputClass } from '../../../ui/components';
import { errorText, type OpError } from './shared';

/** 'all'이면 주소록 전체, 아니면 그룹 id */
export type View = 'all' | string;

interface Props {
  groups: Group[];
  recipientCount: number;
  view: View;
  error: OpError | null;
  busy: boolean;
  onSelect: (view: View) => void;
  onCreate: (name: string) => Promise<boolean>;
}

/** 왼쪽 목록: 주소록 전체와 그룹들. 고르면 오른쪽에 그 목록이 보인다. */
export function GroupList({ groups, recipientCount, view, error, busy, onSelect, onCreate }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = async () => {
    if (busy || !name.trim()) return;
    if (await onCreate(name)) { setAdding(false); setName(''); }
  };

  return (
    <nav aria-label="수신자 목록" className="rounded-card border border-line bg-surface p-3 shadow-card lg:sticky lg:top-6">
      <ul className="space-y-1">
        <Item active={view === 'all'} icon={<BookUser />} label="주소록 전체" count={recipientCount} onClick={() => onSelect('all')} />
      </ul>
      <div className="mt-4 mb-1 px-3 text-xs font-semibold text-muted">그룹</div>
      {groups.length === 0 && !adding && <EmptyState size="sm" className="justify-start px-3 !py-1" title="아직 그룹이 없습니다." />}
      <ul className="space-y-1">
        {groups.map((g) => (
          <Item
            key={g.id}
            active={view === g.id}
            icon={g.isDefault ? <Star className="fill-current text-mark-strong" role="img" aria-label="메일 기본 선택" /> : <span className="size-4" />}
            label={g.name}
            count={g.memberIds.length}
            onClick={() => onSelect(g.id)}
          />
        ))}
      </ul>
      {adding ? (
        <div className="mt-2 space-y-2 px-1">
          <input
            aria-label="새 그룹 이름"
            placeholder="새 그룹 이름"
            className={inputClass}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setAdding(false); }}
          />
          {error && <p className="text-xs text-danger">{errorText(error)}</p>}
          <FormActions>
            <Button variant="ghost" onClick={() => { setAdding(false); setName(''); }}>취소</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void submit()}>만들기</Button>
          </FormActions>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3 w-full" icon={<Plus />} disabled={busy} onClick={() => setAdding(true)}>새 그룹</Button>
      )}
    </nav>
  );
}

function Item({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-ctl px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 ${active ? 'bg-info-wash font-semibold text-ink' : 'text-ink hover:bg-sunken'}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="tabular-nums text-muted">{count}</span>
      </button>
    </li>
  );
}
