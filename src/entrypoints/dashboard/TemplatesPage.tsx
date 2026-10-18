import { Copy, FilePlus, Search, Star } from 'lucide-react';
import { useState } from 'react';
import { builtinDefaultTemplate } from '../../core/templates/default-template';
import type { Template } from '../../core/types/template';
import { Button, Card, InlineAlert, inputClass, Select, StatusBadge, useToast } from '../../ui/components';
import { matchesQuery } from '../../ui/components/select-filter';
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

type SortKey = 'recent' | 'added' | 'updated' | 'name';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: '최근 만든 순' },
  { value: 'added', label: '만든 순' },
  { value: 'updated', label: '최근 수정순' },
  { value: 'name', label: '이름순' },
];

/** 템플릿 배열 순서가 곧 만든 순서다(새 템플릿은 끝에 붙는다). */
function sortTemplates(list: Template[], key: SortKey): Template[] {
  if (key === 'added') return list;
  if (key === 'recent') return [...list].reverse();
  if (key === 'updated') return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function TemplatesPage() {
  const { data, error, reload, run } = useTemplates();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
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
  const shownTemplates = sortTemplates((data?.templates ?? []).filter((t) => matchesQuery(t.name, q)), sort);

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
          <div className="mb-3 flex items-center gap-2">
            <div className="relative max-w-sm min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input type="search" aria-label="템플릿 이름으로 찾기" placeholder="템플릿 이름으로 찾기 (초성 가능)" className={`${inputClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select className="w-36 shrink-0" aria-label="정렬" value={sort} options={SORT_OPTIONS} onChange={(v) => setSort(v as SortKey)} />
          </div>
          <div className="overflow-x-auto rounded-ctl border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-sunken text-muted">
                <tr>
                  <th className="w-14 px-3 py-2 text-center font-medium">순번</th>
                  <th className="px-3 py-2 text-center font-medium">이름</th>
                  <th className="w-32 px-3 py-2 text-center font-medium">수정일</th>
                  <th className="px-3 py-2"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {shownTemplates.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted">찾는 템플릿이 없습니다.</td></tr>
                )}
                {shownTemplates.map((t, i) => (
                  <tr key={t.id} onClick={() => go(t.id)} className="cursor-pointer border-t border-line hover:bg-sunken">
                    <td className="px-3 py-2 text-center text-muted tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-ink">{t.name}</span>
                        {t.isDefault && <StatusBadge status="ok">기본</StatusBadge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted tabular-nums">{t.updatedAt.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {!t.isDefault && <Button variant="ghost" icon={<Star />} disabled={busy} onClick={() => void handle(() => run('templates/set-default', { id: t.id }), '기본 템플릿을 변경했습니다')}>기본으로</Button>}
                        <Button variant="ghost" icon={<Copy />} disabled={busy} onClick={() => void create(t, `${t.name} 복사`)}>복제</Button>
                        <ConfirmDeleteButton disabled={busy} title={`'${t.name}' 템플릿을 삭제할까요?`} description="삭제하면 되돌릴 수 없습니다." onConfirm={() => void handle(() => run('templates/delete', { id: t.id }), '템플릿을 삭제했습니다')} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {toast.node}
    </div>
  );
}
