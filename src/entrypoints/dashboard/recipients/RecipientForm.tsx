import { useState } from 'react';
import type { RecipientInput } from '../../../core/types/config-file';
import type { Group, Recipient } from '../../../core/types/recipient';
import { Button, Card, Field, inputClass } from '../../../ui/components';
import { errorText, type OpError } from './shared';

interface Props {
  /** null이면 새 수신자 */
  recipient: Recipient | null;
  groups: Group[];
  error: OpError | null;
  busy: boolean;
  onSubmit: (input: RecipientInput) => void;
  onCancel: () => void;
}

export function RecipientForm({ recipient, groups, error, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(recipient?.name ?? '');
  const [email, setEmail] = useState(recipient?.email ?? '');
  const [dept, setDept] = useState(recipient?.dept ?? '');
  const [memo, setMemo] = useState(recipient?.memo ?? '');
  const [defaultRole, setDefaultRole] = useState<'to' | 'cc'>(recipient?.defaultRole ?? 'to');
  const [enabled, setEnabled] = useState(recipient?.enabled ?? true);
  const [groupIds, setGroupIds] = useState<string[]>(
    recipient ? groups.filter((g) => g.memberIds.includes(recipient.id)).map((g) => g.id) : groups.filter((g) => g.isDefault).map((g) => g.id),
  );
  const toggleGroup = (id: string) => setGroupIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const emailErr = error && (error.code === 'INVALID_EMAIL' || error.code === 'DUPLICATE_EMAIL') ? errorText(error) : undefined;
  const otherErr = error && !emailErr ? errorText(error) : undefined;

  const submit = () => onSubmit({
    ...(recipient ? { id: recipient.id } : {}),
    name, email, dept: dept || undefined, memo: memo || undefined, defaultRole, enabled, groupIds,
  });

  return (
    <Card title={recipient ? '수신자 수정' : '수신자 추가'}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="이름" htmlFor="rc-name"><input id="rc-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="이메일" htmlFor="rc-email" error={emailErr}><input id="rc-email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="부서" htmlFor="rc-dept"><input id="rc-dept" className={inputClass} value={dept} onChange={(e) => setDept(e.target.value)} /></Field>
        <Field label="기본 역할" htmlFor="rc-role">
          <select id="rc-role" className={inputClass} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as 'to' | 'cc')}>
            <option value="to">TO</option>
            <option value="cc">CC</option>
          </select>
        </Field>
      </div>
      <Field label="메모" htmlFor="rc-memo"><input id="rc-memo" className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        사용
      </label>
      <Field label="소속 그룹">
        {groups.length === 0 ? <p className="text-sm text-muted">그룹이 없습니다.</p> : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
        )}
      </Field>
      {otherErr && <p className="text-xs text-danger">{otherErr}</p>}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={submit}>저장</Button>
        <Button variant="ghost" onClick={onCancel}>취소</Button>
      </div>
    </Card>
  );
}
