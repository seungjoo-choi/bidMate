import { Pencil, Star, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { resolveRecipients } from '../../../core/recipients/resolve';
import type { Group, Recipient } from '../../../core/types/recipient';
import { Button, InlineAlert, StatusBadge, inputClass } from '../../../ui/components';
import { MemberPicker } from './MemberPicker';
import { ConfirmDeleteButton, matchesRecipient, RecipientFilterBar, RoleToggle, sortRecipients, errorText, type OpError, type RecipientSort, type Role } from './shared';

const REASON: Record<string, string> = { missing: '삭제된 수신자', disabled: '발송 꺼짐', duplicate: '이메일 중복' };

interface Props {
  group: Group;
  recipients: Recipient[];
  error: OpError | null;
  busy: boolean;
  onSave: (group: { id: string; name: string; memberIds: string[]; roleOverrides?: Record<string, Role> }, okText?: string) => Promise<boolean>;
  onDelete: () => void;
  onSetDefault: () => void;
  onNewRecipient: () => void;
}

/** 선택한 그룹의 멤버와 받는 방식. 여기서 바꾸는 것은 누르는 즉시 저장된다. */
export function GroupDetail({ group, recipients, error, busy, onSave, onDelete, onSetDefault, onNewRecipient }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<RecipientSort>('added');

  const byId = new Map(recipients.map((r) => [r.id, r]));
  const resolved = resolveRecipients(group, recipients);
  const overrides = group.roleOverrides ?? {};
  const roleOf = (r: Recipient): Role => (Object.hasOwn(overrides, r.id) ? overrides[r.id]! : r.defaultRole);
  const save = (memberIds: string[], roleOverrides: Record<string, Role>, okText?: string) =>
    onSave({ id: group.id, name: group.name, memberIds, roleOverrides }, okText);

  const setRole = (id: string, v: Role) => void save(group.memberIds, { ...overrides, [id]: v }, '받는 방식을 바꿨습니다.');
  const remove = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    void save(group.memberIds.filter((m) => m !== id), next, '그룹에서 뺐습니다.');
  };
  const add = async (ids: string[]) => {
    if (await save([...group.memberIds, ...ids], overrides, `${ids.length}명을 추가했습니다.`)) setPicking(false);
  };
  const rename = async () => {
    if (renaming === null || busy || !renaming.trim()) return;
    if (await onSave({ id: group.id, name: renaming, memberIds: group.memberIds, roleOverrides: group.roleOverrides }, '이름을 바꿨습니다.')) setRenaming(null);
  };

  const candidates = recipients.filter((r) => !group.memberIds.includes(r.id));
  const skipped = resolved.skipped;
  // 삭제된 수신자는 검색에 걸리지 않으므로 검색 중이 아닐 때만 맨 끝에 보인다.
  const members = group.memberIds.flatMap((id) => byId.get(id) ?? []);
  const matched = q.trim() ? members.filter((r) => matchesRecipient(r, q)) : members;
  const missingIds = q.trim() ? [] : group.memberIds.filter((id) => !byId.has(id));
  const shownIds = [...sortRecipients(matched, sort).map((r) => r.id), ...missingIds];

  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className="space-y-3 border-b border-line px-6 pt-5 pb-4">
        {renaming !== null ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="그룹 이름"
                className={`${inputClass} min-w-0 flex-1`}
                value={renaming}
                autoFocus
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(null); }}
              />
              <Button disabled={busy || !renaming.trim()} onClick={() => void rename()}>저장</Button>
              <Button variant="ghost" onClick={() => setRenaming(null)}>취소</Button>
            </div>
            {error && <p className="text-xs text-danger">{errorText(error)}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="title-mark truncate text-lg font-semibold text-ink">{group.name}</h2>
              {group.isDefault && <StatusBadge status="ok">메일 기본 선택</StatusBadge>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" icon={<Pencil />} disabled={busy} onClick={() => setRenaming(group.name)}>이름 바꾸기</Button>
              {!group.isDefault && <Button variant="ghost" icon={<Star />} disabled={busy} onClick={onSetDefault}>메일 기본으로</Button>}
              <ConfirmDeleteButton disabled={busy} title={`'${group.name}' 그룹을 삭제할까요?`} description="그룹만 지워지고 수신자는 주소록에 남습니다. 삭제하면 되돌릴 수 없습니다." onConfirm={onDelete} />
            </div>
          </div>
        )}
        <p className="text-sm text-muted">
          메일을 받는 사람 <b className="text-ink tabular-nums">{resolved.to.length}</b>명, 참조 <b className="text-ink tabular-nums">{resolved.cc.length}</b>명
          {group.isDefault ? '. 메일을 작성할 때 이 그룹이 먼저 선택됩니다.' : ''}
        </p>
      </header>

      <div className="space-y-4 px-6 py-5">
        {error && renaming === null && <p className="text-xs text-danger">{errorText(error)}</p>}
        {skipped.length > 0 && (
          <InlineAlert tone="warn">
            메일에서 빠지는 수신자 {skipped.length}명: {skipped.map((s) => `${s.name ?? s.email ?? '(이름 없음)'}(${REASON[s.reason]})`).join(', ')}
          </InlineAlert>
        )}

        {picking ? (
          <MemberPicker candidates={candidates} busy={busy} onAdd={(ids) => void add(ids)} onClose={() => setPicking(false)} onNewRecipient={onNewRecipient} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<UserPlus />} disabled={busy} onClick={() => setPicking(true)}>주소록에서 추가</Button>
            <Button variant="ghost" disabled={busy} onClick={onNewRecipient}>새 수신자 추가</Button>
          </div>
        )}

        {group.memberIds.length === 0 ? (
          <p className="rounded-ctl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
            이 그룹에 아직 아무도 없습니다. [주소록에서 추가]로 수신자를 넣어 주세요.
          </p>
        ) : (
          <>
            <RecipientFilterBar q={q} onQ={setQ} sort={sort} onSort={setSort} total={members.length} matched={matched.length} />
            <ul className="max-h-[max(16rem,calc(100vh-26rem))] divide-y divide-line overflow-y-auto rounded-ctl border border-line">
              {shownIds.length === 0 && <li className="px-4 py-4 text-center text-sm text-muted">찾는 수신자가 없습니다.</li>}
              {shownIds.map((id, i) => {
                const r = byId.get(id);
                return (
                  <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <span className="w-6 shrink-0 text-center text-sm text-muted tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[0.9375rem] font-semibold ${r ? 'text-ink' : 'text-faint'}`}>
                        {r ? r.name : '(삭제된 수신자)'}
                        {r?.memo && <span className="ml-1.5 font-normal text-muted">({r.memo})</span>}
                        {r?.dept && <span className="ml-2 text-xs font-normal text-muted">{r.dept}</span>}
                      </div>
                      {r && <div className="mt-0.5 truncate font-mono text-xs text-muted">{r.email}</div>}
                    </div>
                    {r && !r.enabled && <StatusBadge status="idle">발송 꺼짐</StatusBadge>}
                    {r && <RoleToggle label={`${r.name} 받는 방식`} value={roleOf(r)} disabled={busy} onChange={(v) => setRole(id, v)} />}
                    <Button variant="ghost" disabled={busy} onClick={() => remove(id)}>빼기</Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

