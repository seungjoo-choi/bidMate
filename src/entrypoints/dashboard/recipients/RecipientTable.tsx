import type { Group, Recipient } from '../../../core/types/recipient';
import { Button, Card, StatusBadge } from '../../../ui/components';
import { ConfirmDeleteButton } from './shared';

interface Props {
  recipients: Recipient[];
  groups: Group[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (r: Recipient) => void;
  onToggle: (r: Recipient) => void;
  onDelete: (id: string) => void;
}

export function RecipientTable({ recipients, groups, busy, onAdd, onEdit, onToggle, onDelete }: Props) {
  return (
    <Card title="수신자" action={<Button variant="secondary" disabled={busy} onClick={onAdd}>수신자 추가</Button>}>
      {recipients.length === 0 ? (
        <p className="text-sm text-muted">등록된 수신자가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-ctl border border-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-sunken text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">이메일</th>
                <th className="px-3 py-2 font-medium">부서</th>
                <th className="px-3 py-2 font-medium">기본 역할</th>
                <th className="px-3 py-2 font-medium">사용</th>
                <th className="px-3 py-2 font-medium">그룹</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold text-ink">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-muted">{r.email}</td>
                  <td className="px-3 py-2 text-muted">{r.dept ?? ''}</td>
                  <td className="px-3 py-2">{r.defaultRole === 'to' ? 'TO' : 'CC'}</td>
                  <td className="px-3 py-2">
                    <button type="button" disabled={busy} onClick={() => onToggle(r)} aria-label="사용 여부 전환">
                      <StatusBadge status={r.enabled ? 'ok' : 'idle'}>{r.enabled ? '사용' : '사용 안 함'}</StatusBadge>
                    </button>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{groups.filter((g) => g.memberIds.includes(r.id)).length}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" disabled={busy} onClick={() => onEdit(r)}>수정</Button>
                      <ConfirmDeleteButton disabled={busy} onConfirm={() => onDelete(r.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
