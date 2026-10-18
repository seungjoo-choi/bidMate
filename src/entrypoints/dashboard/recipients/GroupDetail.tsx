import { useState } from 'react';
import { resolveRecipients } from '../../../core/recipients/resolve';
import type { Group, Recipient } from '../../../core/types/recipient';
import { Button, Card, inputClass } from '../../../ui/components';

type Role = 'to' | 'cc';
const REASON: Record<string, string> = { missing: '삭제된 수신자', disabled: '사용 안 함', duplicate: '중복' };

interface Props {
  group: Group | null;
  recipients: Recipient[];
  busy: boolean;
  onSave: (group: { id: string; name: string; memberIds: string[]; roleOverrides?: Record<string, Role> }) => void;
}

export function GroupDetail({ group, recipients, busy, onSave }: Props) {
  const [addId, setAddId] = useState('');
  if (!group) return <Card title="그룹 상세" description="왼쪽에서 그룹을 선택해 주세요." />;

  const byId = new Map(recipients.map((r) => [r.id, r]));
  const resolved = resolveRecipients(group, recipients);
  const candidates = recipients.filter((r) => !group.memberIds.includes(r.id));
  const save = (memberIds: string[], roleOverrides?: Record<string, Role>) =>
    onSave({ id: group.id, name: group.name, memberIds, roleOverrides });

  const setRole = (id: string, v: string) => {
    const next = { ...(group.roleOverrides ?? {}) };
    if (v === 'to' || v === 'cc') next[id] = v; else delete next[id];
    save(group.memberIds, next);
  };
  const remove = (id: string) => {
    const next = { ...(group.roleOverrides ?? {}) };
    delete next[id];
    save(group.memberIds.filter((m) => m !== id), next);
  };
  const add = () => {
    if (!addId) return;
    save([...group.memberIds, addId], group.roleOverrides);
    setAddId('');
  };

  const skipped = resolved.skipped;
  return (
    <Card title={`${group.name} 상세`} description={`TO ${resolved.to.length}명, CC ${resolved.cc.length}명, 제외 ${skipped.length}명${skipped.length ? `(${skipped.map((s) => `${s.name ?? s.email ?? s.id}: ${REASON[s.reason]}`).join(', ')})` : ''}`}>
      {group.memberIds.length === 0 && <p className="text-sm text-muted">멤버가 없습니다.</p>}
      <ul className="divide-y divide-line">
        {group.memberIds.map((id) => {
          const r = byId.get(id);
          const override = group.roleOverrides && Object.hasOwn(group.roleOverrides, id) ? group.roleOverrides[id] : '';
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className={`truncate font-semibold ${r ? 'text-ink' : 'text-faint'}`}>{r ? r.name : '(삭제된 수신자)'}</div>
                {r && <div className="truncate font-mono text-sm text-muted">{r.email}</div>}
              </div>
              <select aria-label="역할" className={`${inputClass} !w-28`} disabled={busy || !r} value={override ?? ''} onChange={(e) => setRole(id, e.target.value)}>
                <option value="">기본</option>
                <option value="to">TO</option>
                <option value="cc">CC</option>
              </select>
              <Button variant="ghost" disabled={busy} onClick={() => remove(id)}>제거</Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select aria-label="추가할 수신자" className={`${inputClass} min-w-0 flex-1`} value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">추가할 수신자 선택</option>
          {candidates.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.email})</option>)}
        </select>
        <Button variant="secondary" disabled={busy || !addId} onClick={add}>멤버 추가</Button>
      </div>
    </Card>
  );
}
