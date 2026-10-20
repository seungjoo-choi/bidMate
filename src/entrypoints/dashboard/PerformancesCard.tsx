import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAmountComma, formatAmountFull, formatAmountShort } from '../../core/model/format';
import { parseSheetAmount, type SheetParse } from '../../core/performances/sheet';
import { compareAmountOf, type PerformanceImportResult, type PerformanceInput, type PerformanceRecord, type PerformancesSnapshot } from '../../core/types/performance';
import { buildTemplateXlsx, parsePerformanceXlsx } from '../../engine/performances/xlsx-io';
import { send } from '../../messaging/bus';
import { Button, Card, ConfirmDialog, EmptyState, Field, FormActions, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';

type LoadError = { code?: string; message: string; path?: string };
type SheetOk = Extract<SheetParse, { ok: true }>;
type Preview = { fileName: string; parse: SheetParse; mode: 'append' | 'replace'; shown: number };

const PREVIEW_STEP = 20;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const errOf = (e: unknown): LoadError => ({
  code: (e as { code?: string } | null)?.code,
  message: e instanceof Error ? e.message : String(e),
  path: (e as { path?: string } | null)?.path,
});

interface FormState {
  id?: string; title: string; client: string; amount: string; startAt: string; endAt: string; share: string; category: string; note: string;
}
const EMPTY_FORM: FormState = { title: '', client: '', amount: '', startAt: '', endAt: '', share: '', category: '', note: '' };
const formOf = (p: PerformanceRecord): FormState => ({
  id: p.id, title: p.title, client: p.client, amount: String(p.amount), startAt: p.startAt, endAt: p.endAt ?? '',
  share: p.share !== undefined ? String(p.share) : '', category: p.category ?? '', note: p.note ?? '',
});

export function PerformancesCard() {
  const [data, setData] = useState<PerformancesSnapshot | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setData(await send('performances/list', undefined));
      setLoadError(null);
    } catch (e) {
      setLoadError(errOf(e));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const repair = async () => {
    setBusy(true);
    try {
      await send('config/repair', { file: 'performances' });
      await reload();
      setNotice('백업 후 초기화했습니다.');
    } catch (e) {
      setLoadError(errOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !data) {
    const corrupt = loadError.code === 'CONFIG_CORRUPT' && loadError.path === 'config/performances.json';
    return (
      <Card title="실적 목록">
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p>{corrupt ? '설정 파일이 손상되었습니다.' : loadError.code === 'CONFIG_NEWER' ? '설정 파일이 더 새로운 버전으로 저장되어 있습니다. 확장 프로그램을 업데이트해 주세요.' : loadError.message}</p>
              {loadError.path && <p className="mt-1 font-mono text-xs text-muted">{loadError.path}</p>}
            </div>
            {corrupt && <Button variant="secondary" disabled={busy} onClick={() => void repair()}>백업 후 초기화</Button>}
          </div>
        </InlineAlert>
      </Card>
    );
  }

  const items = data?.items ?? [];
  const inProgress = items.filter((p) => !p.endAt).length;

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([buildTemplateXlsx() as BlobPart], { type: XLSX_MIME }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bidmate-실적양식.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setFileError(null);
    try {
      const parse = await parsePerformanceXlsx(new Uint8Array(await file.arrayBuffer()));
      if (!parse.ok) { setFileError(parse.error); setPreview(null); return; }
      setPreview({ fileName: file.name, parse, mode: 'append', shown: PREVIEW_STEP });
    } catch (e) {
      setFileError(errOf(e).message);
    }
  };

  const applyImport = async (p: Preview) => {
    const parse = p.parse as SheetOk;
    const add = parse.rows.flatMap((r) => (r.input ? [r.input] : []));
    setBusy(true);
    try {
      const res: PerformanceImportResult = await send('performances/import', { plan: { mode: p.mode, add } });
      setData({ items: res.items, warnings: res.warnings });
      setPreview(null);
      setNotice(`실적 ${res.summary.added}건을 가져왔습니다. 건너뛴 행 ${res.summary.skipped.length + parse.invalid}.`);
    } catch (e) {
      setFileError(errOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async () => {
    if (!form) return;
    setFormError(null);
    const amount = parseSheetAmount(form.amount);
    const input: PerformanceInput = {
      ...(form.id ? { id: form.id } : {}),
      title: form.title, client: form.client, amount: amount ?? Number.NaN, startAt: form.startAt,
      ...(form.endAt ? { endAt: form.endAt } : {}),
      ...(form.share.trim() ? { share: Number(form.share) } : {}),
      ...(form.category.trim() ? { category: form.category } : {}),
      ...(form.note.trim() ? { note: form.note } : {}),
    };
    setBusy(true);
    try {
      setData(await send('performances/save', { performance: input }));
      setForm(null);
      setNotice('저장했습니다.');
    } catch (e) {
      setFormError(errOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    if (!id) return;
    setBusy(true);
    try {
      setData(await send('performances/delete', { id }));
      setNotice('삭제했습니다.');
    } catch (e) {
      setLoadError(errOf(e));
    } finally {
      setBusy(false);
    }
  };

  const setF = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const parsedAmount = form ? parseSheetAmount(form.amount) : null;

  return (
    <Card title="실적 목록" description="공고의 실적 인정기간과 인정금액을 우리 실적과 비교하는 데 씁니다. 계약금액은 실적증명서의 계약금액(부가세 포함) 그대로 적습니다.">
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={<Download />} onClick={downloadTemplate}>빈 양식 내려받기</Button>
        <Button variant="secondary" icon={<Upload />} disabled={busy} onClick={() => fileRef.current?.click()}>엑셀 가져오기</Button>
        <Button icon={<Plus />} disabled={busy || !!preview} onClick={() => { setForm({ ...EMPTY_FORM }); setFormError(null); setNotice(null); }}>실적 추가</Button>
        <span className="ml-auto text-sm text-muted">총 {items.length}건, 진행 중 {inProgress}건</span>
      </div>
      {data && data.warnings.length > 0 && data.warnings.map((w) => <InlineAlert key={w} tone="warn">{w}</InlineAlert>)}
      {fileError && (
        <InlineAlert tone="error">
          <p>파일을 읽지 못했습니다: {fileError}</p>
          <p className="mt-1">빈 양식을 내려받아 같은 머리글로 저장하세요.</p>
        </InlineAlert>
      )}
      {notice && <InlineAlert tone="ok">{notice}</InlineAlert>}

      {preview && preview.parse.ok ? (
        <PreviewView
          preview={preview} existing={items.length} busy={busy}
          onMode={(mode) => setPreview({ ...preview, mode })}
          onMore={() => setPreview({ ...preview, shown: preview.shown + PREVIEW_STEP })}
          onCancel={() => setPreview(null)}
          onApply={() => void applyImport(preview)}
        />
      ) : items.length === 0 ? (
        <EmptyState title="등록된 실적이 없습니다" hint="빈 양식을 내려받아 채운 뒤 엑셀 가져오기를 누르거나, 실적 추가로 직접 입력하세요." />
      ) : (
        <div className="overflow-auto rounded-ctl border border-line">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-sunken text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">사업명</th>
                <th className="px-3 py-2 font-medium">발주기관</th>
                <th className="px-3 py-2 text-right font-medium">계약금액</th>
                <th className="px-3 py-2 font-medium">지분율</th>
                <th className="px-3 py-2 font-medium">비교 금액</th>
                <th className="px-3 py-2 font-medium">착수일</th>
                <th className="px-3 py-2 font-medium">완료일</th>
                <th className="px-3 py-2 font-medium">분야</th>
                <th className="px-3 py-2 font-medium">출처</th>
                <th className="px-3 py-2"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold text-ink">{p.title}</td>
                  <td className="px-3 py-2">{p.client}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatAmountComma(p.amount)}</td>
                  <td className="px-3 py-2">{p.share ?? 100}%</td>
                  <td className="px-3 py-2">{formatAmountShort(compareAmountOf(p))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.startAt}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.endAt ?? <StatusBadge status="idle">진행 중</StatusBadge>}</td>
                  <td className="px-3 py-2">{p.category ?? ''}</td>
                  <td className="px-3 py-2">{p.source === 'excel' ? '엑셀' : '직접'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" icon={<Pencil />} disabled={busy} onClick={() => { setForm(formOf(p)); setFormError(null); setNotice(null); }}>수정</Button>
                      <Button variant="ghost" icon={<Trash2 />} disabled={busy} className="text-danger" onClick={() => setDeleteId(p.id)}>삭제</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="space-y-4 border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-ink">{form.id ? '실적 수정' : '실적 추가'}</h3>
          <Field label="사업명" htmlFor="perf-title"><input id="perf-title" className={inputClass} value={form.title} onChange={(e) => setF({ title: e.target.value })} /></Field>
          <Field label="발주기관" htmlFor="perf-client"><input id="perf-client" className={inputClass} value={form.client} onChange={(e) => setF({ client: e.target.value })} /></Field>
          <Field label="계약금액" htmlFor="perf-amount" help={parsedAmount !== null ? formatAmountFull(parsedAmount) : '원 단위로 적습니다. 콤마는 있어도 됩니다.'}>
            <input id="perf-amount" className={inputClass} value={form.amount} onChange={(e) => setF({ amount: e.target.value })} />
          </Field>
          <Field label="착수일" htmlFor="perf-start"><input id="perf-start" type="date" className={inputClass} value={form.startAt} onChange={(e) => setF({ startAt: e.target.value })} /></Field>
          <Field label="완료일" htmlFor="perf-end" help="비우면 진행 중으로 봅니다."><input id="perf-end" type="date" className={inputClass} value={form.endAt} onChange={(e) => setF({ endAt: e.target.value })} /></Field>
          <Field label="지분율(%)" htmlFor="perf-share"><input id="perf-share" type="number" min={1} max={100} placeholder="100" className={inputClass} value={form.share} onChange={(e) => setF({ share: e.target.value })} /></Field>
          <Field label="분야" htmlFor="perf-cat"><input id="perf-cat" className={inputClass} value={form.category} onChange={(e) => setF({ category: e.target.value })} /></Field>
          <Field label="비고" htmlFor="perf-note"><textarea id="perf-note" rows={3} className={inputClass} value={form.note} onChange={(e) => setF({ note: e.target.value })} /></Field>
          {formError && <InlineAlert tone="error">{formError}</InlineAlert>}
          <FormActions>
            <Button variant="secondary" disabled={busy} onClick={() => setForm(null)}>취소</Button>
            <Button loading={busy} onClick={() => void submitForm()}>저장</Button>
          </FormActions>
        </div>
      )}

      <ConfirmDialog open={deleteId !== null} title="이 실적을 삭제할까요? 되돌릴 수 없습니다." onCancel={() => setDeleteId(null)} onConfirm={() => void doDelete()} />
    </Card>
  );
}

function PreviewView({ preview, existing, busy, onMode, onMore, onCancel, onApply }: {
  preview: Preview; existing: number; busy: boolean;
  onMode: (m: 'append' | 'replace') => void; onMore: () => void; onCancel: () => void; onApply: () => void;
}) {
  const parse = preview.parse as SheetOk;
  const rows = parse.rows.slice(0, preview.shown);
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-ink">가져오기 미리보기: 정상 {parse.valid}행, 오류 {parse.invalid}행</h3>
      <div className="overflow-auto rounded-ctl border border-line">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-sunken text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">사업명</th>
              <th className="px-3 py-2 font-medium">발주기관</th>
              <th className="px-3 py-2 text-right font-medium">계약금액</th>
              <th className="px-3 py-2 font-medium">착수일</th>
              <th className="px-3 py-2 font-medium">완료일</th>
              <th className="px-3 py-2 font-medium">지분율</th>
              <th className="px-3 py-2 font-medium">오류 내용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={`border-t border-line ${r.error ? 'bg-sunken' : ''}`}>
                <td className="px-3 py-2 tabular-nums text-muted">{r.row}</td>
                <td className="px-3 py-2">{r.error ? <StatusBadge status="error">오류</StatusBadge> : <StatusBadge status="ok">정상</StatusBadge>}</td>
                <td className="px-3 py-2">{r.input?.title ?? ''}</td>
                <td className="px-3 py-2">{r.input?.client ?? ''}</td>
                <td className="px-3 py-2 text-right font-mono">{r.input ? formatAmountComma(r.input.amount) : ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.input?.startAt ?? ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.input ? (r.input.endAt ?? '진행 중') : ''}</td>
                <td className="px-3 py-2">{r.input ? `${r.input.share ?? 100}%` : ''}</td>
                <td className="px-3 py-2 text-danger">{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parse.rows.length > preview.shown && <Button variant="secondary" onClick={onMore}>행 더 보기</Button>}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="perf-mode" checked={preview.mode === 'append'} onChange={() => onMode('append')} />기존 목록에 추가
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="perf-mode" checked={preview.mode === 'replace'} onChange={() => onMode('replace')} />기존 목록을 비우고 교체
        </label>
      </div>
      {preview.mode === 'replace' && <InlineAlert tone="warn">기존 실적 {existing}건이 삭제됩니다.</InlineAlert>}
      <FormActions>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>취소</Button>
        <Button loading={busy} disabled={parse.valid === 0} onClick={onApply}>{parse.valid}행 가져오기</Button>
      </FormActions>
    </div>
  );
}
