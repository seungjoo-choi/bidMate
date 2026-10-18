import { Copy, FilePlus, Star } from 'lucide-react';
import { useState } from 'react';
import { builtinDefaultTemplate } from '../../core/templates/default-template';
import type { Template } from '../../core/types/template';
import { Button, Card, InlineAlert, StatusBadge, useToast } from '../../ui/components';
import { send } from '../../messaging/bus';
import { ConfirmDeleteButton } from './recipients/shared';
import { useTemplates } from '../../ui/hooks/useConfig';
import { FsErrorAlert } from './FsErrorAlert';

export function templateErrorText(code: string, message: string): string {
  if (code === 'LAST_TEMPLATE') return '마지막 템플릿은 삭제할 수 없습니다.';
  if (code === 'INVALID_VALUE') return '입력값이 올바르지 않습니다. 이름과 항목을 확인해 주세요.';
  if (code === 'NOT_FOUND') return '템플릿을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.';
  return message;
}

export function TemplatesPage() {
  const { data, error, reload, run } = useTemplates();
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<{ code: string; message: string } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const toast = useToast();

  const go = (id: string) => { window.location.hash = `#/templates/${id}`; };

  const handle = async (fn: () => Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>, done?: string) => {
    setBusy(true);
    setOpError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setOpError(r.error);
    else if (done) toast.show(done);
    return r;
  };

  const create = async (base: Template, name: string) => {
    setBusy(true);
    setOpError(null);
    try {
      const before = new Set((data?.templates ?? []).map((t) => t.id));
      const snap = await send('templates/save', { template: { name, layout: 'list', subject: base.subject, greeting: base.greeting, closing: base.closing, sections: base.sections } });
      await reload();
      const created = snap.templates.find((t) => !before.has(t.id));
      if (created) go(created.id);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      setOpError({ code: typeof code === 'string' ? code : 'INTERNAL', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    setRepairing(true);
    try {
      await send('config/repair', { file: 'templates' });
      await reload();
    } catch (e) {
      setOpError({ code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRepairing(false);
    }
  };

  const corrupt = error?.code === 'CONFIG_CORRUPT';
  const newer = error?.code === 'CONFIG_NEWER';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="title-mark text-2xl font-bold tracking-tight">템플릿</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={busy || !data} onClick={() => void create(builtinDefaultTemplate(new Date()), '기본 템플릿 (새 양식)')}>기본 양식으로 새로 만들기</Button>
          <Button icon={<FilePlus />} disabled={busy || !data} onClick={() => void create(builtinDefaultTemplate(new Date()), '새 템플릿')}>새 템플릿</Button>
        </div>
      </div>

      {corrupt && (
        <InlineAlert tone="error">
          <div className="flex items-center justify-between gap-4">
            <span>템플릿 파일이 손상되었습니다. {error?.message}</span>
            <Button variant="secondary" loading={repairing} onClick={() => void repair()}>백업 후 초기화</Button>
          </div>
        </InlineAlert>
      )}
      {newer && <InlineAlert tone="warn">템플릿 파일이 더 새로운 버전으로 저장되어 있어 열 수 없습니다. {error?.message}</InlineAlert>}
      {!corrupt && !newer && <FsErrorAlert error={error} onRetry={() => void reload()} />}
      {opError && <InlineAlert tone="error">{templateErrorText(opError.code, opError.message)}</InlineAlert>}
      {data && data.warnings.length > 0 && (
        <InlineAlert tone="warn">
          <ul className="list-disc pl-4">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </InlineAlert>
      )}

      {data && (
        <Card title="템플릿 목록" description="행을 누르면 편집 화면으로 이동합니다.">
          <ul className="divide-y divide-line">
            {data.templates.map((t) => (
              <li
                key={t.id}
                onClick={() => go(t.id)}
                className="flex cursor-pointer flex-wrap items-center gap-3 py-3 hover:bg-sunken"
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{t.name}</span>
                {t.isDefault && <StatusBadge status="ok">기본</StatusBadge>}
                <span className="w-24 shrink-0 text-sm text-muted">{t.updatedAt.slice(0, 10)}</span>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" icon={<Star />} disabled={busy || t.isDefault} onClick={() => void handle(() => run('templates/set-default', { id: t.id }), '기본 템플릿을 변경했습니다')}>기본으로</Button>
                  <Button variant="secondary" icon={<Copy />} disabled={busy} onClick={() => void create(t, `${t.name} 복사`)}>복제</Button>
                  <ConfirmDeleteButton disabled={busy} title={`'${t.name}' 템플릿을 삭제할까요?`} description="삭제하면 되돌릴 수 없습니다." onConfirm={() => void handle(() => run('templates/delete', { id: t.id }), '템플릿을 삭제했습니다')} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {toast.node}
    </div>
  );
}
