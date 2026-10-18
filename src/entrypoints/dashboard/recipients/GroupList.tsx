import { useState } from 'react';
import type { Group } from '../../../core/types/recipient';
import { Button, Card, Field, StatusBadge, inputClass } from '../../../ui/components';
import { ConfirmDeleteButton, errorText, type OpError } from './shared';

interface Props {
  groups: Group[];
  selectedId: string | null;
  error: OpError | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onSave: (group: { id?: string; name: string; memberIds: string[]; roleOverrides?: Record<string, 'to' | 'cc'> }) => Promise<boolean>;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export function GroupList({ groups, selectedId, error, busy, onSelect, onSave, onDelete, onSetDefault }: Props) {
  // editingId: 이름 수정 중인 그룹 id, 'new'면 추가 중
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');

  const startNew = () => { setEditingId('new'); setName(''); };
  const startEdit = (g: Group) => { setEditingId(g.id); setName(g.name); };
  const submit = async () => {
    const g = groups.find((x) => x.id === editingId);
    const ok = await onSave(g ? { id: g.id, name, memberIds: g.memberIds, roleOverrides: g.roleOverrides } : { name, memberIds: [] });
    if (ok) setEditingId(null);
  };

  return (
    <Card title="그룹" action={<Button variant="secondary" disabled={busy} onClick={startNew}>그룹 추가</Button>}>
      {editingId && (
        <div className="space-y-2">
          <Field label={editingId === 'new' ? '새 그룹 이름' : '그룹 이름 수정'} htmlFor="group-name" error={error ? errorText(error) : undefined}>
            <input id="group-name" className={inputClass} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>저장</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>취소</Button>
          </div>
        </div>
      )}
      {groups.length === 0 && <p className="text-sm text-muted">그룹이 없습니다.</p>}
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.id} className={`rounded-ctl border p-3 ${g.id === selectedId ? 'border-accent bg-info-wash' : 'border-line'}`}>
            <button type="button" onClick={() => onSelect(g.id)} className="block w-full text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-ink">{g.name}</span>
                {g.isDefault && <StatusBadge status="ok">기본</StatusBadge>}
              </div>
              <div className="mt-0.5 text-sm text-muted">멤버 {g.memberIds.length}명</div>
            </button>
            <div className="mt-2 flex flex-wrap gap-1">
              {!g.isDefault && <Button variant="ghost" disabled={busy} onClick={() => onSetDefault(g.id)}>기본으로</Button>}
              <Button variant="ghost" disabled={busy} onClick={() => startEdit(g)}>이름 수정</Button>
              <ConfirmDeleteButton disabled={busy} onConfirm={() => onDelete(g.id)} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
