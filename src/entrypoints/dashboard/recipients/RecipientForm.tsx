import { Check, Search } from 'lucide-react';
import { useState } from 'react';
import type { RecipientInput } from '../../../core/types/config-file';
import type { Group, Recipient } from '../../../core/types/recipient';
import { Button, Field, inputClass } from '../../../ui/components';
import { matchesQuery } from '../../../ui/components/select-filter';
import { Switch, errorText, type OpError } from './shared';

/** 그룹이 이 개수 이상이면 칩 위에 검색 칸을 둔다 */
const GROUP_SEARCH_MIN = 8;

interface Props {
  /** null이면 새 사람 */
  recipient: Recipient | null;
  groups: Group[];
  /** 새 사람일 때 미리 체크해 둘 그룹 */
  initialGroupIds: string[];
  error: OpError | null;
  busy: boolean;
  onSubmit: (input: RecipientInput) => void;
  onCancel: () => void;
}

/** 사람 등록/수정 폼. 등록은 팝업, 수정은 서랍 패널 안에 들어간다. 받는 방식(TO/CC)은 그룹에서 정하므로 여기에는 없다. */
export function RecipientForm({ recipient, groups, initialGroupIds, error, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(recipient?.name ?? '');
  const [email, setEmail] = useState(recipient?.email ?? '');
  const [dept, setDept] = useState(recipient?.dept ?? '');
  const [memo, setMemo] = useState(recipient?.memo ?? '');
  const [enabled, setEnabled] = useState(recipient?.enabled ?? true);
  const [groupIds, setGroupIds] = useState<string[]>(
    recipient ? groups.filter((g) => g.memberIds.includes(recipient.id)).map((g) => g.id) : initialGroupIds,
  );
  const [groupQ, setGroupQ] = useState('');
  const shownGroups = groups.filter((g) => matchesQuery(g.name, groupQ));
  const toggleGroup = (id: string) => setGroupIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const emailErr = error && (error.code === 'INVALID_EMAIL' || error.code === 'DUPLICATE_EMAIL') ? errorText(error) : undefined;
  const otherErr = error && !emailErr ? errorText(error) : undefined;
  const noDefault = !groups.some((g) => g.isDefault);

  const submit = () => onSubmit({
    ...(recipient ? { id: recipient.id } : {}),
    name, email, dept: dept || undefined, memo: memo || undefined,
    // 화면에서는 받는 방식을 그룹에서만 정한다. 기존 값은 그대로 두고, 새 사람은 '받는 사람'으로 시작한다.
    defaultRole: recipient?.defaultRole ?? 'to',
    enabled, groupIds,
  });

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label="이름" htmlFor="rc-name"><input id="rc-name" className={inputClass} value={name} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="이메일" htmlFor="rc-email" error={emailErr}><input id="rc-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="부서 (선택)" htmlFor="rc-dept"><input id="rc-dept" className={inputClass} value={dept} onChange={(e) => setDept(e.target.value)} /></Field>
      <Field label="메모 (선택)" htmlFor="rc-memo"><input id="rc-memo" className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <Field label="소속 그룹" help={noDefault ? "저장하면 '전체' 그룹이 만들어지고 메일 기본 선택으로 지정됩니다." : '메일은 그룹 단위로 보냅니다. 그룹에 넣어야 메일을 받습니다.'}>
        {groups.length === 0 ? <p className="text-sm text-muted">아직 그룹이 없습니다.</p> : (
          <div className="space-y-2">
            {groups.length >= GROUP_SEARCH_MIN && (
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <input aria-label="그룹 찾기" placeholder="그룹 찾기 (초성 가능)" className={`${inputClass} pl-9`} value={groupQ} onChange={(e) => setGroupQ(e.target.value)} />
              </div>
            )}
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {shownGroups.map((g) => {
                const on = groupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGroup(g.id)}
                    className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors motion-reduce:transition-none [&_svg]:size-3.5 ${on ? 'border-accent bg-accent/15 font-semibold text-accent' : 'border-line-strong text-muted hover:border-ink/40 hover:text-ink'}`}
                  >
                    {on && <Check aria-hidden />}
                    {g.name}
                  </button>
                );
              })}
              {shownGroups.length === 0 && <p className="text-sm text-muted">찾는 그룹이 없습니다.</p>}
            </div>
          </div>
        )}
      </Field>
      <div className="flex items-start justify-between gap-4 rounded-ctl border border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-ink">메일 발송</div>
          <p className="mt-0.5 text-xs text-muted">끄면 그룹에 있어도 메일에서 빠집니다. 잠시 빼 둘 때 씁니다.</p>
        </div>
        <Switch label="메일 발송" checked={enabled} onChange={setEnabled} />
      </div>
      {otherErr && <p className="text-xs text-danger">{otherErr}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>저장</Button>
        <Button variant="ghost" onClick={onCancel}>취소</Button>
      </div>
    </form>
  );
}
