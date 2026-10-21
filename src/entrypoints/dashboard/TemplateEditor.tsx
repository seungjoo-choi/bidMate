import { Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMail } from '../../core/templates/render';
import { kindOf } from '../../core/model/ids';
import { sampleNotice, samplePrespecNotice } from '../../core/templates/sample-notice';
import type { RenderedMail } from '../../core/types/mail';
import type { Notice, NoticeKind } from '../../core/types/notice';
import type { Template, TemplateFieldKey } from '../../core/types/template';
import { send } from '../../messaging/bus';
import { BackLink, Button, Card, Field, InlineAlert, inputClass, StatusBadge, useToast } from '../../ui/components';
import { useTemplates } from '../../ui/hooks/useConfig';
import { FsErrorAlert } from './FsErrorAlert';
import { templateErrorText } from './TemplatesPage';
import { SectionEditor, sectionNumber } from './templates/SectionEditor';
import { VariablePalette } from './templates/VariablePalette';
import { useVariableSuggest } from './templates/VariableSuggest';
import { replaceRange, type FocusEl } from './templates/variable-suggest';
import { MailPreviewFrame } from './templates/MailPreviewFrame';

/** i, j 위치를 맞바꾼 새 배열. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
}

/** 편집 대상 필드만 비교용으로 직렬화한다(updatedAt, isDefault 제외). */
const snapshotOf = (t: Template) => JSON.stringify({ name: t.name, layout: t.layout, subject: t.subject, greeting: t.greeting, closing: t.closing, sections: t.sections });

export function TemplateEditor({ id }: { id: string }) {
  const { data, error, reload, run } = useTemplates();
  const [draft, setDraft] = useState<Template | null>(null);
  const [savedSnap, setSavedSnap] = useState('');
  const [saving, setSaving] = useState(false);
  const [opError, setOpError] = useState<{ code: string; message: string } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [notice, setNotice] = useState<Notice>(() => sampleNotice());
  // 종류는 생성 시 정해지고 편집기에서 바꾸지 못한다.
  const kind = kindOf(data?.templates.find((t) => t.id === id));
  const sampleOf = (k: NoticeKind) => (k === 'prespec' ? samplePrespecNotice() : sampleNotice());
  const [rendered, setRendered] = useState<RenderedMail | null>(null);
  const lastFocus = useRef<FocusEl | null>(null);
  const toast = useToast();

  // 본문 형식은 번호 목록만 쓴다. 표로 저장된 옛 템플릿도 편집기에서는 목록으로 열고, 저장하면 목록으로 바뀐다.
  const stored = data?.templates.find((t) => t.id === id) ?? null;
  const found = stored && (stored.layout === 'list' ? stored : { ...stored, layout: 'list' as const });

  // 최초 로드 시에만 초안을 만든다(저장 후에는 save 핸들러가 교체).
  useEffect(() => {
    if (found && !draft) { setDraft(found); setSavedSnap(snapshotOf(found)); }
  }, [found, draft]);

  // 미리보기 표본: 같은 종류의 최신 공고 1건, 없으면 그 종류의 표본 공고.
  const loaded = data !== undefined && data !== null;
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    setNotice(sampleOf(kind));
    (async () => {
      try {
        const list = (await send('notice/list', undefined)).filter((e) => kindOf(e) === kind);
        if (list.length === 0) return;
        const latest = list.reduce((a, b) => (b.collectedAt > a.collectedAt ? b : a));
        const got = await send('notice/get', { noticeId: latest.noticeId });
        if (alive && got) setNotice(got.notice);
      } catch { /* 표본 공고로 대체 */ }
    })();
    return () => { alive = false; };
  }, [loaded, kind]);

  // 300ms 디바운스 렌더.
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      try { setRendered(renderMail(draft, notice)); } catch { setRendered(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, notice]);

  const dirty = draft !== null && snapshotOf(draft) !== savedSnap;
  const usedKeys = useMemo(() => new Set<TemplateFieldKey>((draft?.sections ?? []).flatMap((s) => s.items.flatMap((i) => (i.kind === 'text' ? [] : [i.fieldKey])))), [draft]);

  // 템플릿 이름은 렌더되지 않으므로 변수 대상에서 뺀다.
  const onFocusInput = (el: FocusEl) => { if (el.id !== 'tpl-name') lastFocus.current = el; };
  const trackFocus = (e: { currentTarget: FocusEl }) => onFocusInput(e.currentTarget);

  /** 마지막으로 선택한 입력칸의 커서 위치에 {이름}을 넣는다. 선택한 칸이 없으면 클립보드에 복사한다. */
  const insertVariable = (name: string) => {
    const el = lastFocus.current;
    const text = `{${name}}`;
    if (!el || !el.isConnected) {
      void navigator.clipboard.writeText(text).then(() => toast.show(`${text} 를 복사했습니다`), () => {});
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    replaceRange(el, start, el.selectionEnd ?? start, text);
  };
  const suggest = useVariableSuggest((t): t is FocusEl => t === lastFocus.current && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement), kind);

  const patch = (p: Partial<Template>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setOpError(null);
    const r = await run('templates/save', {
      template: { id: draft.id, name: draft.name, ...(kind !== 'bid' ? { kind } : {}), layout: draft.layout, subject: draft.subject, greeting: draft.greeting, closing: draft.closing, sections: draft.sections },
    });
    setSaving(false);
    if (!r.ok) { setOpError(r.error); return; }
    // run이 data를 응답 스냅샷으로 교체했다. 초안은 그 값으로 맞춘다.
    setSavedSnap(snapshotOf(draft));
    toast.saved('템플릿을 저장했습니다');
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
    <BackLink href="#/templates">템플릿 목록</BackLink>
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
        <div className="flex items-center gap-3">{back}<h1 className="title-mark text-2xl font-bold tracking-tight">템플릿 편집</h1>{kind === 'prespec' && <StatusBadge status="idle">사전규격</StatusBadge>}</div>
        <Button icon={<Save />} disabled={!dirty} loading={saving} onClick={() => void save()}>저장</Button>
      </div>
      {opError && <InlineAlert tone="error">{templateErrorText(opError.code, opError.message)}</InlineAlert>}

      {draft && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_720px]">
          <div className="min-w-0 space-y-6" {...suggest.handlers}>
            <Card title="기본 정보" action={<VariablePalette onInsert={insertVariable} kind={kind} />}>
              <Field label="이름" htmlFor="tpl-name">
                <input id="tpl-name" className={inputClass} value={draft.name} onFocus={trackFocus} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="제목" htmlFor="tpl-subject" help="메일 제목입니다. { 를 입력하면 변수를 골라 넣을 수 있습니다.">
                <input id="tpl-subject" className={inputClass} value={draft.subject} onFocus={trackFocus} onChange={(e) => patch({ subject: e.target.value })} />
              </Field>
              <Field label="인사말" htmlFor="tpl-greeting">
                <textarea id="tpl-greeting" rows={3} className={inputClass} value={draft.greeting} onFocus={trackFocus} onChange={(e) => patch({ greeting: e.target.value })} />
              </Field>
            </Card>

            <Card
              title="섹션"
              action={
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    icon={<Plus />}
                    onClick={() => patch({ sections: [...draft.sections, { id: `sec_${crypto.randomUUID().slice(0, 8)}`, title: '', items: [], plain: true }] })}
                  >
                    문구 추가
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Plus />}
                    onClick={() => patch({ sections: [...draft.sections, { id: `sec_${crypto.randomUUID().slice(0, 8)}`, title: '새 섹션', items: [] }] })}
                  >
                    섹션 추가
                  </Button>
                </div>
              }
            >
              {draft.sections.length === 0 && <p className="text-sm text-muted">섹션이 없습니다.</p>}
              {draft.sections.map((s, i) => (
                <SectionEditor
                  key={s.id}
                  section={s}
                  index={i}
                  number={sectionNumber(draft.sections, i)}
                  usedKeys={usedKeys}
                  kind={kind}
                  onChange={(next) => patch({ sections: draft.sections.map((x) => (x.id === s.id ? next : x)) })}
                  onRemove={() => patch({ sections: draft.sections.filter((x) => x.id !== s.id) })}
                  onMoveUp={i > 0 ? () => patch({ sections: swap(draft.sections, i, i - 1) }) : undefined}
                  onMoveDown={i < draft.sections.length - 1 ? () => patch({ sections: swap(draft.sections, i, i + 1) }) : undefined}
                  onFocusInput={onFocusInput}
                />
              ))}
            </Card>

            <Card title="맺음말">
              <textarea aria-label="맺음말" rows={3} className={inputClass} value={draft.closing} onFocus={trackFocus} onChange={(e) => patch({ closing: e.target.value })} />
            </Card>
          </div>

          <div className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            <Card title="미리보기" description={notice.id === sampleOf(kind).id ? '표본 공고로 보여 줍니다.' : `최근 공고: ${notice.basic.title.value ?? ""}`}>
              {rendered ? <MailPreviewFrame html={rendered.html} subject={rendered.subject} height="max(560px, calc(100vh - 210px))" /> : <p className="text-sm text-muted">미리보기를 만드는 중입니다.</p>}
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
      {suggest.popup}
    </div>
  );
}
