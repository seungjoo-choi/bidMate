import { Download, Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { Group, Recipient } from '../../../core/types/recipient';
import { Button } from '../../../ui/components';
import { ConfirmDeleteButton, matchesRecipient, RecipientFilterBar, sortRecipients, Switch, type RecipientSort } from './shared';

interface Props {
  recipients: Recipient[];
  groups: Group[];
  busy: boolean;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (r: Recipient) => void;
  onToggle: (r: Recipient) => void;
  onDelete: (id: string) => void;
}

/** 주소록 전체: 등록된 모든 사람. 등록, 수정, 삭제, 발송 켬/끔은 여기서 한다. */
export function RecipientTable({ recipients, groups, busy, onAdd, onImport, onEdit, onToggle, onDelete }: Props) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<RecipientSort>('added');
  const filtered = q.trim() ? recipients.filter((r) => matchesRecipient(r, q)) : recipients;
  const shown = sortRecipients(filtered, sort);
  const groupNames = (id: string) => groups.filter((g) => g.memberIds.includes(id)).map((g) => g.name);

  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
        <div className="min-w-0">
          <h2 className="title-mark text-lg font-semibold text-ink">주소록 전체</h2>
          <p className="mt-1 pl-[11.5px] text-sm text-muted">수신자 {recipients.length}명. 메일은 그룹 단위로 보내므로, 추가한 뒤 그룹에 넣어 주세요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<Download />} disabled={busy} onClick={onImport}>네이버웍스에서 불러오기</Button>
          <Button icon={<UserPlus />} disabled={busy} onClick={onAdd}>수신자 추가</Button>
        </div>
      </header>
      <div className="space-y-4 px-6 py-5">
        {recipients.length === 0 ? (
          <div className="rounded-ctl border border-dashed border-line-strong px-4 py-10 text-center">
            <p className="text-sm text-muted">아직 수신자가 없습니다.</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button variant="secondary" icon={<Download />} disabled={busy} onClick={onImport}>네이버웍스에서 불러오기</Button>
              <Button icon={<UserPlus />} disabled={busy} onClick={onAdd}>첫 수신자 추가</Button>
            </div>
          </div>
        ) : (
          <>
            <RecipientFilterBar q={q} onQ={setQ} sort={sort} onSort={setSort} total={recipients.length} matched={filtered.length} />
            {/* 사람이 많아도 페이지가 길어지지 않게 표 안에서만 스크롤한다. 머리글은 위에 고정. */}
            <div className="max-h-[max(16rem,calc(100vh-22rem))] overflow-auto rounded-ctl border border-line">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-sunken text-muted">
                  <tr>
                    <th className="w-14 px-3 py-2 text-center font-medium">순번</th>
                    <th className="px-3 py-2 font-medium">이름</th>
                    <th className="px-3 py-2 font-medium">이메일</th>
                    <th className="px-3 py-2 font-medium">소속 그룹</th>
                    <th className="px-3 py-2 font-medium" title="끄면 그룹에 있어도 메일에서 빠집니다">메일 발송</th>
                    <th className="px-3 py-2"><span className="sr-only">작업</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-muted">찾는 수신자가 없습니다.</td></tr>
                  )}
                  {shown.map((r, i) => {
                    const names = groupNames(r.id);
                    return (
                      <tr key={r.id} className={`border-t border-line ${r.enabled ? '' : 'text-faint'}`}>
                        <td className="px-3 py-2 text-center text-muted tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className={`text-[15px] font-semibold ${r.enabled ? 'text-ink' : 'text-faint'}`}>{r.name}</div>
                          {r.dept && <div className="text-xs text-muted">{r.dept}</div>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted">{r.email}</td>
                        <td className="px-3 py-2">
                          {names.length ? (
                            // 그룹 이름 중간에서 줄이 끊기지 않게 그룹마다 꼬리표로 나눈다.
                            <div className="flex min-w-24 flex-wrap gap-1">
                              {names.map((n) => <span key={n} className="rounded-full bg-sunken px-2 py-0.5 text-xs whitespace-nowrap text-ink">{n}</span>)}
                            </div>
                          ) : <span className="text-faint">없음</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Switch label={`${r.name} 메일 발송`} checked={r.enabled} disabled={busy} onChange={() => onToggle(r)} />
                            <span className="text-xs text-muted">{r.enabled ? '켬' : '꺼짐'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" icon={<Pencil />} disabled={busy} onClick={() => onEdit(r)}>수정</Button>
                            <ConfirmDeleteButton variant="secondary" disabled={busy} title={`'${r.name}'을(를) 삭제할까요?`} description="주소록과 모든 그룹에서 빠집니다. 삭제하면 되돌릴 수 없습니다." onConfirm={() => onDelete(r.id)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
