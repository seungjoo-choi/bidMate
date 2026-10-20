import { FileText, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { editTargetsOf, inputKindOf, parseFieldInput, type EditableKey, type EditInputKind } from '../../../core/model/field-edit';
import { getField } from '../../../core/model/notice-fields';
import { VARIABLE_BY_KEY } from '../../../core/templates/variables';
import { NEEDS_REVIEW_TEXT, resolveValue } from '../../../core/templates/values';
import { EXTRACTION_KEYS, type EvidenceRef, type ExtractedItem, type Extraction, type ExtractionKey } from '../../../core/types/extraction';
import type { FieldSource, FieldValue } from '../../../core/types/common';
import type { UnresolvedVar } from '../../../core/types/mail';
import type { Notice, NoticeFieldKey } from '../../../core/types/notice';
import type { TemplateFieldKey } from '../../../core/types/template';
import { Button, InlineAlert, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { evidenceMeta, fileDisplayName, findTextPath, reasonText } from '../../../ui/review/view';
import { TextDrawer, type DrawerTarget } from '../review/TextDrawer';

const SOURCE_LABEL: Record<FieldSource['kind'], string> = { api: '나라장터 API', html: '나라장터 화면', document: '첨부 문서', user: '직접 입력', derived: '다른 값으로 계산' };

interface Candidate { text: string; from: string; evidence?: EvidenceRef }
export interface NoticeEdit { key: EditableKey; value: unknown | null; raw?: string }
interface Target { key: EditableKey; kind: EditInputKind; label: string; fv: FieldValue<unknown> | undefined }

const PLACEHOLDER: Partial<Record<EditInputKind, string>> = {
  datetime: '예: 2026-10-21 18:00', amount: '원 단위 숫자', amount_short: '원 단위 숫자', score: '점수', period: '년 수(예: 3)', bool_apply: '적용 또는 미적용',
};

const fieldOf = (notice: Notice, key: EditableKey): FieldValue<unknown> | undefined => (key.startsWith('custom.')
  ? notice.customFields?.[key.slice('custom.'.length)]
  : getField(notice, key as NoticeFieldKey));

const show = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));

/** 공고 필드 값과 평가정보 추출 결과에서 이 항목의 근거와 후보를 모은다. */
function gather(notice: Notice, extraction: Extraction | null, fieldKey: TemplateFieldKey) {
  const fv: FieldValue<unknown> | undefined = fieldKey.startsWith('custom.')
    ? notice.customFields?.[fieldKey.slice('custom.'.length)]
    : (getField(notice, fieldKey as NoticeFieldKey) ?? undefined);
  const ex: ExtractedItem<unknown> | undefined = extraction
    ? ((EXTRACTION_KEYS as string[]).includes(fieldKey) ? extraction.items[fieldKey as ExtractionKey] : extraction.extras[fieldKey])
    : undefined;
  const cands: Candidate[] = [];
  const push = (c: Candidate) => { if (c.text && !cands.some((x) => x.text === c.text)) cands.push(c); };
  for (const c of ex?.candidates ?? []) push({ text: show(c.value), from: evidenceMeta(c.evidence), evidence: c.evidence });
  for (const c of fv?.candidates ?? []) push({ text: show(c.value), from: SOURCE_LABEL[c.source.kind] ?? c.source.kind });
  const reason = fv?.note ?? reasonText(ex?.reason);
  return { fv, ex, cands, reason };
}

export interface ResolveDialogProps {
  noticeId: string;
  notice: Notice;
  extraction: Extraction | null;
  item: UnresolvedVar;
  fieldKey: TemplateFieldKey;
  /** 이 메일 양식에만 값을 고정한다. 잠긴 상태면 주지 않는다. */
  onApplyMail?: (text: string) => void;
  /** 공고 데이터에 저장한다(value null은 자동값으로 되돌리기). 실패하면 오류 문구를 돌려준다. */
  onSaveNotice?: (edits: NoticeEdit[]) => Promise<string | null>;
  onClose: () => void;
}

/** 메일 점검의 "확인 필요" 항목 하나를 이 화면에서 확인하고 고치는 팝업. */
export function ResolveDialog({ noticeId, notice, extraction, item, fieldKey, onApplyMail, onSaveNotice, onClose }: ResolveDialogProps) {
  const { fv, ex, cands, reason } = gather(notice, extraction, fieldKey);
  const rv = resolveValue(notice, fieldKey);
  const [text, setText] = useState(() => (rv.status === 'missing' ? '' : rv.text.replace(` (${NEEDS_REVIEW_TEXT})`, '')));
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 공고에 저장할 대상. 합성 항목은 실제 필드로 펼친다. 글 항목 하나면 위 입력칸을 같이 쓰고, 아니면 필드별 칸을 따로 둔다.
  const targets: Target[] = editTargetsOf(fieldKey).map((key) => ({
    key, kind: inputKindOf(key), label: VARIABLE_BY_KEY.get(key)?.label ?? key.replace(/^custom\./, ''), fv: fieldOf(notice, key),
  }));
  const shared = targets.length === 1 && (targets[0]!.kind === 'text' || targets[0]!.kind === 'longtext');
  const [init] = useState(() => ({
    vals: Object.fromEntries(targets.map((t) => [t.key, typeof t.fv?.value === 'boolean' ? (t.fv.raw ?? '') : show(t.fv?.value)])) as Record<string, string>,
    joints: Object.fromEntries(targets.map((t) => [t.key, typeof t.fv?.value === 'boolean' ? t.fv.value : undefined])) as Record<string, boolean | undefined>,
  }));
  const [vals, setVals] = useState(init.vals);
  const [joints, setJoints] = useState(init.joints);
  const editedTargets = targets.filter((t) => t.fv?.status === 'user_edited');

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (drawer) return; // 드로어가 열려 있으면 Esc는 드로어가 받는다.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, onClose]);

  const files = (extraction?.files ?? []).filter((f) => f.textPath);
  const openEvidence = (e: EvidenceRef) => {
    const textPath = extraction ? findTextPath(extraction.files, e) : undefined;
    if (textPath) setDrawer({ textPath, line: e.line, title: e.sourceFile });
  };
  const evidence = ex?.evidence;
  const value = text.trim();
  /** 후보 값을 메일 문구 칸에 넣고, 공고 칸이 하나뿐이면 그 칸에도 넣는다. */
  const pickCandidate = (v: string) => {
    setText(v);
    const only = targets.length === 1 ? targets[0]! : undefined;
    if (only && only.kind !== 'bool_joint') setVals((x) => ({ ...x, [only.key]: v }));
  };

  const buildEdits = (): NoticeEdit[] | string => {
    if (shared) {
      const r = parseFieldInput(targets[0]!.kind, text);
      return r.ok ? [{ key: targets[0]!.key, value: r.value, ...(r.raw ? { raw: r.raw } : {}) }] : r.message;
    }
    const out: NoticeEdit[] = [];
    for (const t of targets) {
      const s = (vals[t.key] ?? '').trim();
      const joint = joints[t.key];
      if (t.kind === 'bool_joint' ? joint === undefined : !s) continue; // 비워 둔 칸은 저장하지 않는다.
      // 여러 칸이면 손대지 않은 칸은 저장하지 않는다(자동값이 사용자 수정으로 굳지 않게). 한 칸이면 지금 값 그대로 확정할 수 있다.
      if (targets.length > 1 && s === (init.vals[t.key] ?? '').trim() && joint === init.joints[t.key]) continue;
      const r = parseFieldInput(t.kind, s, { joint });
      if (!r.ok) return `${t.label}: ${r.message}`;
      out.push({ key: t.key, value: r.value, ...(r.raw ? { raw: r.raw } : {}) });
    }
    return out.length > 0 ? out : '공고에 저장할 값을 입력하거나 고쳐 주세요.';
  };

  const submit = async (edits: NoticeEdit[]) => {
    if (!onSaveNotice) return;
    setSaving(true); setError(null);
    const err = await onSaveNotice(edits);
    setSaving(false);
    if (err) setError(err); else onClose();
  };
  const saveNotice = () => {
    const r = buildEdits();
    if (typeof r === 'string') setError(r); else void submit(r);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`${item.label} 확인`} className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-card border border-line bg-surface shadow-overlay">
        <header className="flex items-center gap-3 border-b border-line px-6 py-4">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{item.label}</h2>
          <StatusBadge status="warn">{item.status === 'missing' ? '값 없음' : '확인 필요'}</StatusBadge>
          <Button variant="ghost" size="icon" aria-label="닫기" className="-mr-2" icon={<X />} onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 py-5 text-sm">
          <div className="space-y-1.5 rounded-ctl bg-warn-wash px-4 py-3">
            <p className="font-medium text-ink">
              {item.status === 'missing'
                ? `공고 정보와 첨부 문서에서 ${item.label} 값을 찾지 못했습니다.`
                : `${item.label} 값을 자동으로 확정하지 못했습니다${reason ? ` (${reason})` : ''}.`}
            </p>
            <p className="text-muted">
              {cands.length >= 2
                ? '아래 후보 중 맞는 값을 고르거나, 문서를 열어 확인한 뒤 값을 입력하세요.'
                : '근거 문장이나 문서를 열어 확인한 뒤, 맞는 값을 아래에 입력하세요.'}
            </p>
            {rv.status === 'needs_review' && <p className="text-muted">지금 값: <span className="text-ink">{text || '—'}</span></p>}
          </div>

          {(evidence || fv?.source?.evidence) && (
            <section className="space-y-1.5">
              <h3 className="font-semibold text-ink">근거</h3>
              {evidence ? (
                <>
                  <div className="text-muted">{evidenceMeta(evidence)}</div>
                  <blockquote className="border-l-2 border-line-strong pl-3 text-ink">{evidence.evidence}</blockquote>
                  <button type="button" className="text-accent hover:underline" onClick={() => openEvidence(evidence)}>원문에서 보기</button>
                </>
              ) : fv?.source && (
                <>
                  <div className="text-muted">{SOURCE_LABEL[fv.source.kind] ?? fv.source.kind}{fv.source.page !== undefined ? `, ${fv.source.page}쪽` : ''}</div>
                  <blockquote className="border-l-2 border-line-strong pl-3 text-ink">{fv.source.evidence}</blockquote>
                </>
              )}
            </section>
          )}

          {cands.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold text-ink">후보 {cands.length}개</h3>
              <ul className="space-y-1.5">
                {cands.map((c, i) => (
                  <li key={i} className={`flex items-start gap-3 rounded-ctl border px-3 py-2 ${value === c.text ? 'border-ink' : 'border-line'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-ink">{c.text}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{c.from}</span>
                        {c.evidence && <button type="button" className="text-accent hover:underline" onClick={() => openEvidence(c.evidence!)}>원문에서 보기</button>}
                      </div>
                    </div>
                    <Button variant="secondary" className="shrink-0" onClick={() => pickCandidate(c.text)}>이 값 쓰기</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="font-semibold text-ink">문서에서 직접 찾기</h3>
            {files.length > 0 ? (
              <>
                <p className="text-xs text-muted">문서를 누르면 ‘{item.label}’로 검색한 상태로 열립니다. 문서에 다른 말(예: 용역기간, 계약기간)로 적혀 있을 수 있으니 검색어를 바꿔 보세요.</p>
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li key={i}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left hover:bg-sunken" onClick={() => setDrawer({ textPath: f.textPath!, title: fileDisplayName(f), query: item.label })}>
                        <FileText className="size-4 shrink-0 text-faint" />
                        <span className="min-w-0 truncate text-accent">{fileDisplayName(f)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted">분석한 문서 텍스트가 없습니다. 공고 상세의 평가정보 탭에서 [평가정보 분석]을 먼저 실행하거나, 나라장터 공고문을 직접 확인하세요.</p>
            )}
          </section>

          <section className="space-y-2">
            <label htmlFor="resolve-value" className="block font-semibold text-ink">값 입력</label>
            <input
              id="resolve-value" ref={inputRef} className={inputClass} value={text} maxLength={shared && targets[0]!.kind === 'longtext' ? 5000 : 500}
              placeholder={`${item.label} 값을 입력하세요`}
              onChange={(e) => setText(e.target.value)}
            />
            {onSaveNotice && targets.length > 0 && !shared && (
              <div className="space-y-2.5 rounded-ctl border border-line px-4 py-3">
                <p className="text-xs text-muted">위 칸은 [이 메일에만 적용]에 쓰는 문구입니다. [공고에 저장]은 아래 칸의 값을 저장합니다{targets.length > 1 ? '(고치지 않은 칸은 그대로 둡니다)' : ''}.</p>
                {targets.map((t) => (
                  <div key={t.key} className="space-y-1">
                    <label htmlFor={`resolve-${t.key}`} className="block text-xs font-medium text-ink">{t.label}</label>
                    {t.kind === 'bool_joint' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex overflow-hidden rounded-ctl border border-line-strong" role="group" aria-label={t.label}>
                          {[true, false].map((b) => (
                            <button type="button" key={String(b)} aria-pressed={joints[t.key] === b} onClick={() => setJoints((j) => ({ ...j, [t.key]: b }))} className={`h-[38px] px-4 text-sm font-medium not-first:border-l not-first:border-line-strong ${joints[t.key] === b ? 'bg-btn text-btn-ink' : 'bg-surface text-muted hover:bg-sunken hover:text-ink'}`}>{b ? '허용' : '불허'}</button>
                          ))}
                        </div>
                        <input id={`resolve-${t.key}`} className={`${inputClass} !w-56`} placeholder="방식(예: 공동이행, 선택)" value={vals[t.key] ?? ''} maxLength={500} onChange={(e) => setVals((v) => ({ ...v, [t.key]: e.target.value }))} />
                      </div>
                    ) : (
                      <input id={`resolve-${t.key}`} className={inputClass} placeholder={PLACEHOLDER[t.kind] ?? `${t.label} 값`} value={vals[t.key] ?? ''} maxLength={t.kind === 'longtext' ? 5000 : 2000} onChange={(e) => setVals((v) => ({ ...v, [t.key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {onSaveNotice && targets.length === 0 && <p className="text-xs text-muted">이 항목은 수집할 때 자동으로 정해져서 공고에 저장할 수 없습니다. 이 메일에서만 고칠 수 있습니다.</p>}
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
          {onSaveNotice && editedTargets.length > 0 && (
            <Button variant="ghost" icon={<RotateCcw />} className="mr-auto" disabled={saving} title="직접 고친 공고 값을 지우고 자동으로 수집한 값으로 돌아갑니다" onClick={() => void submit(editedTargets.map((t) => ({ key: t.key, value: null })))}>자동값으로 되돌리기</Button>
          )}
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          {onApplyMail && (
            <Button variant={onSaveNotice && targets.length > 0 ? 'secondary' : 'primary'} disabled={!value} title="공고 데이터는 그대로 두고 이 메일에서만 값을 바꿉니다" onClick={() => { onApplyMail(value); onClose(); }}>
              이 메일에만 적용
            </Button>
          )}
          {onSaveNotice && targets.length > 0 && <Button disabled={shared && !value} loading={saving} title="공고 값을 고쳐 상세 화면과 다른 메일에도 반영합니다" onClick={saveNotice}>공고에 저장</Button>}
        </footer>
      </div>
      {drawer && <TextDrawer key={`${drawer.textPath}|${drawer.line ?? ''}|${drawer.query ?? ''}`} noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
    </div>,
    document.body,
  );
}
