import { useCallback, useState } from 'react';
import { send } from '../../messaging/bus';
import type { RecipientInput } from '../../core/types/config-file';
import { ALL_GROUP_ID, type Recipient } from '../../core/types/recipient';
import { Button, InlineAlert, useToast } from '../../ui/components';
import { useRecipients } from '../../ui/hooks/useConfig';
import { FsErrorAlert } from './FsErrorAlert';
import { GroupDetail } from './recipients/GroupDetail';
import { GroupList, type View } from './recipients/GroupList';
import { RecipientForm } from './recipients/RecipientForm';
import { RecipientTable } from './recipients/RecipientTable';
import { Drawer, Modal, type OpError } from './recipients/shared';

/** 사람 등록 팝업/수정 서랍. recipient가 null이면 새 사람(팝업), groupIds는 새 사람일 때 미리 체크할 그룹 */
type FormState = null | { recipient: Recipient | null; groupIds: string[] };
type Area = 'newGroup' | 'group' | 'recipient' | 'other';
const FORM_CODES = ['INVALID_EMAIL', 'DUPLICATE_EMAIL', 'DUPLICATE_NAME', 'INVALID_VALUE', 'NOT_FOUND'];

export function RecipientsPage() {
  const { data, error: loadError, reload, run } = useRecipients();
  // null이면 아직 고르지 않음(기본 그룹, 없으면 주소록 전체를 보여 준다)
  const [view, setView] = useState<View | null>(null);
  // 새로 만든 그룹은 응답이 와야 id를 알 수 있어 이름으로 찾아 고른다(그룹 이름은 중복 불가)
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [opError, setOpError] = useState<(OpError & { area: Area }) | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const error: OpError | null = opError ?? (loadError ? { code: loadError.code ?? 'INTERNAL', message: loadError.message, path: loadError.path } : null);
  const isConfigErr = error?.code === 'CONFIG_CORRUPT' || error?.code === 'CONFIG_NEWER';
  // 입력값 오류만 해당 입력 옆에 보이고, 나머지(파일 오류 등)는 위쪽 경고 한 곳에만 보인다.
  const formErr = (area: Area) => (opError && opError.area === area && FORM_CODES.includes(opError.code) ? opError : null);

  const exec = async (area: Area, fn: () => ReturnType<typeof run>, okText?: string): Promise<boolean> => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      setOpError(null);
      if (okText) toast.show(okText);
      return true;
    }
    setOpError({ ...res.error, area, path: (res.error as { path?: string }).path });
    return false;
  };

  const retry = async () => { await reload(); setOpError(null); };
  const closeForm = useCallback(() => { setForm(null); setOpError(null); }, []);

  const repair = async () => {
    // 경로로 대상 파일을 정한다. 짐작해서 멀쩡한 파일을 초기화하면 안 되므로 모르면 하지 않는다.
    const file = repairTarget(error?.path);
    if (!file) return;
    setBusy(true);
    try {
      await send('config/repair', { file });
      setOpError(null);
      await reload();
      toast.show('백업 후 초기화했습니다.');
    } catch (e) {
      setOpError({ code: (e as { code?: string }).code ?? 'INTERNAL', message: e instanceof Error ? e.message : String(e), area: 'other' });
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div>
      <h1 className="title-mark text-2xl font-bold tracking-tight">수신자</h1>
      <p className="mt-1 pl-[13px] text-sm text-muted">공고 메일을 받을 수신자를 주소록에 등록하고 그룹으로 묶습니다. 메일을 작성할 때 그룹을 고릅니다.</p>
    </div>
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        {isConfigErr && error ? <ConfigAlert error={error} busy={busy} onRepair={repair} /> : <FsErrorAlert error={error} onRetry={retry} />}
        {!error && <p className="text-muted">불러오는 중입니다.</p>}
      </div>
    );
  }

  const { groups, recipients } = data;
  const pending = pendingName ? groups.find((g) => g.name === pendingName) : undefined;
  if (pending) { setPendingName(null); setView(pending.id); }
  const group = pending
    ?? (view === 'all' ? undefined : groups.find((g) => g.id === view) ?? (view === null ? groups.find((g) => g.isDefault) : undefined));
  const current: View = group ? group.id : 'all';
  const hasDefault = groups.some((g) => g.isDefault);

  const select = (v: View) => { setPendingName(null); setView(v); setOpError(null); };
  const openNew = (groupId?: string) => {
    setOpError(null);
    const preset = new Set<string>();
    if (groups.some((g) => g.id === ALL_GROUP_ID)) preset.add(ALL_GROUP_ID);
    if (groupId) preset.add(groupId);
    setForm({ recipient: null, groupIds: [...preset] });
  };
  const createGroup = async (name: string) => {
    const ok = await exec('newGroup', () => run('groups/save', { group: { name, memberIds: [] } }), '그룹을 만들었습니다.');
    if (ok) setPendingName(name.trim());
    return ok;
  };
  const saveRecipient = async (input: RecipientInput) => {
    if (await exec('recipient', () => run('recipients/save', { recipient: input }), '저장했습니다.')) setForm(null);
  };
  const toggleEnabled = (r: Recipient) => {
    const groupIds = groups.filter((g) => g.memberIds.includes(r.id)).map((g) => g.id);
    void exec('other', () => run('recipients/save', { recipient: { id: r.id, name: r.name, email: r.email, dept: r.dept, memo: r.memo, defaultRole: r.defaultRole, enabled: !r.enabled, groupIds } }),
      r.enabled ? `${r.name}: 메일 발송을 껐습니다.` : `${r.name}: 메일 발송을 켰습니다.`);
  };

  const recipientForm = (recipient: Recipient | null, groupIds: string[]) => (
    <RecipientForm
      key={recipient?.id ?? 'new'}
      recipient={recipient}
      groups={groups}
      initialGroupIds={groupIds}
      error={formErr('recipient')}
      busy={busy}
      onSubmit={(i) => void saveRecipient(i)}
      onCancel={closeForm}
    />
  );

  return (
    <div className="space-y-6">
      {header}
      {isConfigErr && error
        ? <ConfigAlert error={error} busy={busy} onRepair={repair} />
        : <FsErrorAlert error={error && (opError?.area === 'other' || !FORM_CODES.includes(error.code)) ? error : null} onRetry={retry} />}
      {!hasDefault && recipients.length > 0 && (
        <InlineAlert tone="warn">메일을 작성할 때 먼저 선택될 그룹이 없습니다. 그룹을 열고 [메일 기본으로]를 눌러 주세요.</InlineAlert>
      )}
      {data.warnings.length > 0 && (
        <InlineAlert tone="info">
          <ul className="list-inside list-disc">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </InlineAlert>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <GroupList
          groups={groups}
          recipientCount={recipients.length}
          view={current}
          error={formErr('newGroup')}
          busy={busy}
          onSelect={select}
          onCreate={createGroup}
        />
        <div className="min-w-0">
          {group ? (
            <GroupDetail
              key={group.id}
              group={group}
              recipients={recipients}
              error={formErr('group')}
              busy={busy}
              onSave={(g, okText) => exec('group', () => run('groups/save', { group: g }), okText ?? '저장했습니다.')}
              onDelete={() => void exec('group', () => run('groups/delete', { id: group.id }), '그룹을 삭제했습니다.').then((ok) => { if (ok) select('all'); })}
              onSetDefault={() => void exec('group', () => run('groups/set-default', { id: group.id }), `메일을 작성할 때 '${group.name}'이(가) 먼저 선택됩니다.`)}
              onNewRecipient={() => openNew(group.id)}
            />
          ) : (
            <RecipientTable
              recipients={recipients}
              groups={groups}
              busy={busy}
              onAdd={() => openNew()}
              onEdit={(r) => { setOpError(null); setForm({ recipient: r, groupIds: [] }); }}
              onToggle={toggleEnabled}
              onDelete={(id) => void exec('other', () => run('recipients/delete', { id }), '삭제했습니다.')}
            />
          )}
        </div>
      </div>
      <Drawer open={form?.recipient != null} title="수신자 정보 수정" onClose={closeForm}>
        {form?.recipient && recipientForm(form.recipient, form.groupIds)}
      </Drawer>
      <Modal open={form !== null && !form.recipient} title="수신자 추가" onClose={closeForm}>
        {form && !form.recipient && recipientForm(null, form.groupIds)}
      </Modal>
      {toast.node}
    </div>
  );
}

function repairTarget(path: string | undefined): 'recipients' | 'groups' | null {
  if (path === 'config/recipients.json') return 'recipients';
  if (path === 'config/groups.json') return 'groups';
  return null;
}

function ConfigAlert({ error, busy, onRepair }: { error: OpError; busy: boolean; onRepair: () => void }) {
  const corrupt = error.code === 'CONFIG_CORRUPT' && repairTarget(error.path) !== null;
  return (
    <InlineAlert tone="error">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p>{corrupt ? '설정 파일이 손상되었습니다.' : '설정 파일이 더 새로운 버전으로 저장되어 있습니다. 확장 프로그램을 업데이트해 주세요.'}</p>
          {error.path && <p className="mt-1 font-mono text-xs text-muted">{error.path}</p>}
        </div>
        {corrupt && <Button variant="secondary" disabled={busy} onClick={onRepair}>백업 후 초기화</Button>}
      </div>
    </InlineAlert>
  );
}
