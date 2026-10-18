import { ArrowLeft, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMail } from '../../core/templates/render';
import { sampleNotice } from '../../core/templates/sample-notice';
import type { RenderedMail } from '../../core/types/mail';
import type { Notice } from '../../core/types/notice';
import type { Template, TemplateFieldKey } from '../../core/types/template';
import { send } from '../../messaging/bus';
import { Button, Card, Field, InlineAlert, inputClass, useToast } from '../../ui/components';
import { useTemplates } from '../../ui/hooks/useConfig';
import { FsErrorAlert } from '../../ui/hooks/useFsError';
import { templateErrorText } from './TemplatesPage';
import { SectionEditor } from './templates/SectionEditor';
import { VariablePalette } from './templates/VariablePalette';
import { MailPreviewFrame } from './templates/MailPreviewFrame';

type FocusEl = HTMLInputElement | HTMLTextAreaElement;

/** 편집 대상 필드만 비교용으로 직렬화한다(updatedAt, isDefault 제외). */
const snapshotOf = (t: Template) => JSON.stringify({ name: t.name, subject: t.subject, greeting: t.greeting, closing: t.closing, sections: t.sections });

export function TemplateEditor({ id }: { id: string }) {
  const { data, error, reload, run } = useTemplates();
  const [draft, setDraft] = useState<Template | null>(null);
  const [savedSnap, setSavedSnap] = useState('');
  const [saving, setSaving] = useState(false);
  const [opError, setOpError] = useState<{ code: string; message: string } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [notice, setNotice] = useState<Notice>(() => sampleNotice());
  const [rendered, setRendered] = useState<RenderedMail | null>(null);
  const lastFocus = useRef<FocusEl | null>(null);
  const toast = useToast();

  const found = data?.templates.find((t) => t.id === id) ?? null;

  // 최초 로드 시에만 초안을 만든다(저장 후에는 save 핸들러가 교체).
  useEffect(() => {
    if (found && !draft) { setDraft(found); setSavedSnap(snapshotOf(found)); }
  }, [found, draft]);

  // 미리보기 표본: 최신 공고 1건, 없으면 표본 공고.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await send('notice/list', undefined);
        if (list.length === 0) return;
        const latest = list.reduce((a, b) => (b.collectedAt > a.collectedAt ? b : a));
        const got = await send('notice/get', { noticeId: latest.noticeId });
        if (alive && got) setNotice(got.notice);
      } catch { /* 표본 공고로 대체 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 300ms 디바운스 렌더.
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      try { setRendered(renderMail(draft, notice)); } catch { setRendered(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, notice]);

  const dirty = draft !== null && snapshotOf(draft) !== savedSnap;
  const usedKeys = useMemo(() => new Set<TemplateFieldKey>((draft?.sections ?? []).flatMap((s) => s.items.map((i) => i.fieldKey))), [draft]);

  const onFocusInput = (el: FocusEl) => { lastFocus.current = el; setHasFocus(true); };
  const trackFocus = (e: { currentTarget: FocusEl }) => onFocusInput(e.currentTarget);

  /** 마지막 포커스 입력의 커서 위치에 {이름}을 넣고 React onChange가 돌도록 input 이벤트를 발생시킨다. */
  const insertVariable = (name: string) => {
    const el = lastFocus.current;
    if (!el || !el.isConnected) return;
    const text = `{${name}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
  };

  const patch = (p: Partial<Template>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setOpError(null);
    const r = await run('templates/save', {
      template: { id: draft.id, name: draft.name, subject: draft.subject, greeting: draft.greeting, closing: draft.closing, sections: draft.sections },
    });
    setSaving(false);
    if (!r.ok) { setOpError(r.error); return; }
    // run이 data를 응답 스냅샷으로 교체했다. 초안은 그 값으로 맞춘다.
    setSavedSnap(snapshotOf(draft));
    toast.show('템플릿을 저장했습니다');
  };

  // 응답 스냅샷이 서버에서 보정된 경우를 반영한다(변경 없는 상태일 때만).
  useEffect(() => {
    if (found && draft && !dirty && snapshotOf(found) !== snapshotOf(draft)) { setDraft(found); setSavedSnap(snapshotOf(found)); }
  }, [found, draft, dirty]);

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

  const back = (
    <Button variant="ghost" icon={<ArrowLeft />} onClick={() => { window.location.hash = '#/templates'; }}>템플릿 목록</Button>
  );

  if (error) {
    const corrupt = error.code === 'CONFIG_CORRUPT';
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">{back}<h1 className="title-mark text-2xl font-bold tracking-tight">템플릿 편집</h1></div>
        {corrupt ? (
          <InlineAlert tone="error">
            <div className="flex items-center justify-between gap-4">
              <span>템플릿 파일이 손상되었습니다. {error.message}</span>
              <Button variant="secondary" loading={repairing} onClick={() => void repair()}>백업 후 초기화</Button>
            </div>
          </InlineAlert>
        ) : error.code === 'CONFIG_NEWER' ? (
          <InlineAlert tone="warn">템플릿 파일이 더 새로운 버전으로 저장되어 있어 열 수 없습니다. {error.message}</InlineAlert>
        ) : (
          <FsErrorAlert error={error} onRetry={() => void reload()} />
        )}
      </div>
    );
  }

  if (data && !found) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">{back}<h1 className="title-mark text-2xl font-bold tracking-tight">템플릿 편집</h1></div>
        <InlineAlert tone="error">{templateErrorText('NOT_FOUND', '')}</InlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">{back}<h1 className="title-mark text-2xl font-bold tracking-tight">템플릿 편집</h1></div>
        <Button icon={<Save />} disabled={!dirty} loading={saving} onClick={() => void save()}>저장</Button>
      </div>
      {opError && <InlineAlert tone="error">{templateErrorText(opError.code, opError.message)}</InlineAlert>}

      {draft && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <Card title="기본 정보">
              <Field label="이름" htmlFor="tpl-name">
                <input id="tpl-name" className={inputClass} value={draft.name} onFocus={trackFocus} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="제목" htmlFor="tpl-subject" help="메일 제목입니다. {변수}를 쓸 수 있습니다.">
                <input id="tpl-subject" className={inputClass} value={draft.subject} onFocus={trackFocus} onChange={(e) => patch({ subject: e.target.value })} />
              </Field>
              <Field label="인사말" htmlFor="tpl-greeting">
                <textarea id="tpl-greeting" rows={3} className={inputClass} value={draft.greeting} onFocus={trackFocus} onChange={(e) => patch({ greeting: e.target.value })} />
              </Field>
            </Card>

            <Card title="변수">
              <VariablePalette enabled={hasFocus} onInsert={insertVariable} />
            </Card>

            <Card
              title="섹션"
              action={
                <Button
                  variant="secondary"
                  icon={<Plus />}
                  onClick={() => patch({ sections: [...draft.sections, { id: `sec_${crypto.randomUUID().slice(0, 8)}`, title: '새 섹션', items: [] }] })}
                >
                  섹션 추가
                </Button>
              }
            >
              {draft.sections.length === 0 && <p className="text-sm text-muted">섹션이 없습니다.</p>}
              {draft.sections.map((s, i) => (
                <SectionEditor
                  key={s.id}
                  section={s}
                  index={i}
                  usedKeys={usedKeys}
                  onChange={(next) => patch({ sections: draft.sections.map((x) => (x.id === s.id ? next : x)) })}
                  onRemove={() => patch({ sections: draft.sections.filter((x) => x.id !== s.id) })}
                  onFocusInput={onFocusInput}
                />
              ))}
            </Card>

            <Card title="맺음말">
              <textarea aria-label="맺음말" rows={3} className={inputClass} value={draft.closing} onFocus={trackFocus} onChange={(e) => patch({ closing: e.target.value })} />
            </Card>
          </div>

          <div className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            <Card title="미리보기" description={notice.id === sampleNotice().id ? '표본 공고로 보여 줍니다.' : `최근 공고: ${notice.basic.title.value ?? ""}`}>
              {rendered ? <MailPreviewFrame html={rendered.html} subject={rendered.subject} /> : <p className="text-sm text-muted">미리보기를 만드는 중입니다.</p>}
              {rendered && rendered.unresolved.length > 0 && (
                <InlineAlert tone="warn">
                  <p className="font-semibold">확인 필요</p>
                  <ul className="mt-1 list-disc pl-4">
                    {Array.from(new Map(rendered.unresolved.map((u) => [u.name, u])).values()).map((u) => (
                      <li key={u.name}>{u.label} ({u.status === 'missing' ? '값 없음' : '확인 필요'})</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}
              {rendered && rendered.unknownVars.length > 0 && (
                <InlineAlert tone="error">
                  <p className="font-semibold">알 수 없는 변수</p>
                  <ul className="mt-1 list-disc pl-4">
                    {rendered.unknownVars.map((n) => <li key={n}>{`{${n}}`}</li>)}
                  </ul>
                </InlineAlert>
              )}
            </Card>
          </div>
        </div>
      )}
      {toast.node}
    </div>
  );
}
