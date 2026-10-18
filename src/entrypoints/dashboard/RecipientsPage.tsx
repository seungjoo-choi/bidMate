import { useState } from 'react';
import { send } from '../../messaging/bus';
import type { RecipientInput } from '../../core/types/config-file';
import type { Recipient } from '../../core/types/recipient';
import { Button, InlineAlert, useToast } from '../../ui/components';
import { useRecipients } from '../../ui/hooks/useConfig';
import { FsErrorAlert } from '../../ui/hooks/useFsError';
import { GroupDetail } from './recipients/GroupDetail';
import { GroupList } from './recipients/GroupList';
import { RecipientForm } from './recipients/RecipientForm';
import { RecipientTable } from './recipients/RecipientTable';
import type { OpError } from './recipients/shared';

type FormState = null | { recipient: Recipient | null };
type Area = 'group' | 'recipient' | 'other';

export function RecipientsPage() {
  const { data, error: loadError, reload, run } = useRecipients();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [opError, setOpError] = useState<(OpError & { area: Area }) | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const error: OpError | null = opError ?? (loadError ? { code: loadError.code ?? 'INTERNAL', message: loadError.message, path: loadError.path } : null);
  const isConfigErr = error?.code === 'CONFIG_CORRUPT' || error?.code === 'CONFIG_NEWER';
  const formErr = (area: Area) => (opError && opError.area === area && !isConfigErr ? opError : null);

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

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="title-mark text-2xl font-bold tracking-tight">수신자</h1>
        {isConfigErr && error ? <ConfigAlert error={error} busy={busy} onRepair={repair} /> : <FsErrorAlert error={error} onRetry={retry} />}
        {!error && <p className="text-muted">불러오는 중입니다.</p>}
      </div>
    );
  }

  const group = data.groups.find((g) => g.id === selectedId) ?? data.groups.find((g) => g.isDefault) ?? data.groups[0] ?? null;
  const hasDefault = data.groups.some((g) => g.isDefault);

  const saveGroup = (g: Parameters<NonNullable<React.ComponentProps<typeof GroupList>['onSave']>>[0]) =>
    exec('group', () => run('groups/save', { group: g }), '저장했습니다.');
  const saveRecipient = async (input: RecipientInput) => {
    if (await exec('recipient', () => run('recipients/save', { recipient: input }), '저장했습니다.')) setForm(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="title-mark text-2xl font-bold tracking-tight">수신자</h1>
      {isConfigErr && error
        ? <ConfigAlert error={error} busy={busy} onRepair={repair} />
        : <FsErrorAlert error={error && (opError?.area === 'other' || !['INVALID_EMAIL', 'DUPLICATE_EMAIL', 'DUPLICATE_NAME', 'INVALID_VALUE', 'NOT_FOUND'].includes(error.code)) ? error : null} onRetry={retry} />}
      {!hasDefault && <InlineAlert tone="warn">기본 그룹이 없습니다. 수신자를 추가하거나 [수정] 후 저장하면 '전체' 그룹이 자동으로 만들어져 기본으로 지정됩니다.</InlineAlert>}
      {data.warnings.length > 0 && (
        <InlineAlert tone="info">
          <ul className="list-inside list-disc">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </InlineAlert>
      )}
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <GroupList
          groups={data.groups}
          selectedId={group?.id ?? null}
          error={formErr('group')}
          busy={busy}
          onSelect={setSelectedId}
          onSave={saveGroup}
          onDelete={(id) => void exec('group', () => run('groups/delete', { id }), '삭제했습니다.')}
          onSetDefault={(id) => void exec('group', () => run('groups/set-default', { id }), '기본 그룹을 바꿨습니다.')}
        />
        <div className="min-w-0 space-y-6">
          <GroupDetail group={group} recipients={data.recipients} busy={busy} onSave={(g) => void saveGroup(g)} />
          {form && (
            <RecipientForm
              key={form.recipient?.id ?? 'new'}
              recipient={form.recipient}
              groups={data.groups}
              error={formErr('recipient')}
              busy={busy}
              onSubmit={(i) => void saveRecipient(i)}
              onCancel={() => { setForm(null); setOpError(null); }}
            />
          )}
          <RecipientTable
            recipients={data.recipients}
            groups={data.groups}
            busy={busy}
            onAdd={() => { setOpError(null); setForm({ recipient: null }); }}
            onEdit={(r) => { setOpError(null); setForm({ recipient: r }); }}
            onToggle={(r) => {
              const groupIds = data.groups.filter((g) => g.memberIds.includes(r.id)).map((g) => g.id);
              void exec('other', () => run('recipients/save', { recipient: { id: r.id, name: r.name, email: r.email, dept: r.dept, memo: r.memo, defaultRole: r.defaultRole, enabled: !r.enabled, groupIds } }));
            }}
            onDelete={(id) => void exec('other', () => run('recipients/delete', { id }), '삭제했습니다.')}
          />
        </div>
      </div>
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
