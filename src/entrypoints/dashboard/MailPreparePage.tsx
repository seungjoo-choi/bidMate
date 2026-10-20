import { ArrowLeft, Check, ClipboardCopy, Loader2, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { kindOf, noticeLabel } from '../../core/model/ids';
import { normalizeEmail } from '../../core/recipients/email';
import { resolveRecipients } from '../../core/recipients/resolve';
import { renderMail } from '../../core/templates/render';
import { editsStaleness } from '../../core/mail/edits';
import type { MailDraft, MailEdits } from '../../core/types/mail';
import type { TemplateFieldKey } from '../../core/types/template';
import type { MailStatus, Notice } from '../../core/types/notice';
import type { Extraction } from '../../core/types/extraction';
import type { UnresolvedVar } from '../../core/types/mail';
import { isTemplateFieldKey, VARIABLE_BY_NAME } from '../../core/templates/variables';
import { ResolveDialog, type NoticeEdit } from './mail/ResolveDialog';
import { send } from '../../messaging/bus';
import { Button, Card, ConfirmDialog, Field, InlineAlert, StatusBadge, Select, useToast, type BadgeStatus } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useRecipients, useTemplates } from '../../ui/hooks/useConfig';
import { FsErrorAlert, type FsErrorInfo } from './FsErrorAlert';
import { mailsHash, noticeHash } from './route';
import { formatDateTime } from '../../ui/review/format';
import { ComposeStartButton, ComposeStatus, useComposeController } from '../../ui/compose/ComposeCard';
import { useJobs } from '../../ui/hooks/useJobs';
import { useSettings } from '../../ui/hooks/useSettings';
import { composeProvider, PROVIDER_LABEL } from '../../core/model/mail-provider';
import { MailPreviewFrame } from './templates/MailPreviewFrame';
import { SectionEditor } from './templates/SectionEditor';
import { addRecipient, convertItem, overrideValue, patchTemplate, removeRecipient, resetRecipients, revertItem, startEditing, toggleAttachment, type Recipients, type Role } from './mail-edit-logic';

const STATUS_LABEL: Record<MailStatus, string> = { none: '초안 없음', drafting: '초안 작성됨', ready_for_review: '검토 대기', delivered: '발송 완료' };
const STATUS_TONE: Record<MailStatus, BadgeStatus> = { none: 'idle', drafting: 'warn', ready_for_review: 'warn', delivered: 'ok' };
const SKIP_LABEL = { missing: '없음', disabled: '사용 안 함', duplicate: '중복' } as const;
const CODE_MESSAGE: Record<string, string> = {
  NO_GROUP: '수신자 그룹을 선택해 주세요. 수신자를 직접 바꾼 상태라면 [그룹으로 되돌리기]를 누른 뒤 그룹을 고르세요.',
  NO_RECIPIENTS: '보낼 수 있는 수신자가 없습니다. 받는 사람을 한 명 이상 넣어 주세요.',
  INVALID_VALUE: '편집 내용이 이 공고와 맞지 않습니다. 화면을 새로 고쳐 주세요.',
  JOB_ALREADY_RUNNING: '이 공고의 수집이나 추출이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.',
  GROUP_NOT_FOUND: '자동 작성 설정의 그룹이 삭제되었습니다.',
  TEMPLATE_NOT_FOUND: '자동 작성 설정의 템플릿이 삭제되었습니다.',
  NOT_FOUND: '공고 또는 그룹/템플릿을 찾을 수 없습니다.',
};

/** 첨부 목록을 접어 둘 때 보여 줄 개수. */
const FILE_PREVIEW = 3;

/** 점검 패널 안의 한 구역. 카드 대신 구분선으로 나눈다. */
function PanelSection({ title, meta, metaTone = 'text-muted', children }: { title: string; meta?: string; metaTone?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {meta && <span className={`text-xs font-semibold tabular-nums ${metaTone}`}>{meta}</span>}
      </div>
      {children}
    </section>
  );
}

const toInfo = (e: unknown): FsErrorInfo => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });


/** i, j 위치를 맞바꾼 새 배열. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
}

type Tab = 'edit' | 'preview';
type Confirm = { kind: 'switch'; templateId: string } | { kind: 'reset' } | null;
const ROLES: Role[] = ['to', 'cc'];
const ADD_ERROR = { invalid: '올바른 이메일 주소를 입력하세요.', duplicate: '이미 들어 있는 주소입니다.' } as const;

export function MailPreparePage({ noticeId, from }: { noticeId: string; from?: string }) {
  const [notice, setNotice] = useState<Notice | null | undefined>(undefined);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [resolving, setResolving] = useState<UnresolvedVar | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [edits, setEdits] = useState<MailEdits | null>(null);      // 저장된 공고 전용 양식
  const [working, setWorking] = useState<MailEdits | null>(null);  // 편집 중인 값(저장 전 포함)
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<FsErrorInfo | null>(null);
  const [groupSel, setGroupSel] = useState<string | null>(null);
  const [tplSel, setTplSel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [tab, setTab] = useState<Tab>('preview'); // 수집 직후에도 결과부터 보고 편집으로 넘어간다
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<Role>('to');
  const [addError, setAddError] = useState<string | null>(null);
  const toast = useToast();
  const rec = useRecipients();
  const tpls = useTemplates();
  const jobs = useJobs();
  const { settings: mailSettings } = useSettings();
  const provider = mailSettings ? composeProvider(mailSettings) : 'naverworks';

  const load = async () => {
    try {
      const [r, d, e] = await Promise.all([
        send('notice/get', { noticeId }),
        send('mail/draft-get', { noticeId }),
        send('mail/edits-get', { noticeId }),
      ]);
      setNotice(r ? r.notice : null);
      setExtraction(r?.extraction ?? null);
      setDraft(d);
      setEdits(e);
      setWorking(e);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(toInfo(e));
    }
  };
  useEffect(() => { void load(); }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = rec.data?.groups ?? [];
  const templates = tpls.data?.templates ?? [];
  const groupId = groupSel ?? (groups.find((g) => g.id === notice?.mail.groupId) ?? groups.find((g) => g.isDefault))?.id ?? '';
  const noticeKind = kindOf(notice?.ref);
  const sameKind = templates.filter((t) => kindOf(t) === noticeKind);
  const otherKind = templates.filter((t) => kindOf(t) !== noticeKind);
  const templateId = working?.base.templateId
    ?? tplSel ?? (templates.find((t) => t.id === notice?.mail.templateId) ?? sameKind.find((t) => t.isDefault) ?? sameKind[0] ?? templates.find((t) => t.isDefault) ?? templates[0])?.id ?? '';
  const group = groups.find((g) => g.id === groupId);
  const template = templates.find((t) => t.id === templateId);
  const effective = working?.template ?? template;
  const overridden = !!working?.recipients;

  const resolved = useMemo(() => (group && rec.data ? resolveRecipients(group, rec.data.recipients) : null), [group, rec.data]);
  const baseRecipients = useMemo<Recipients>(() => ({
    to: resolved?.members.filter((m) => m.role === 'to').map((m) => normalizeEmail(m.email)) ?? [],
    cc: resolved?.members.filter((m) => m.role === 'cc').map((m) => normalizeEmail(m.email)) ?? [],
  }), [resolved]);
  const shown = working?.recipients ?? baseRecipients;
  const nameOf = (email: string) => rec.data?.recipients.find((r) => normalizeEmail(r.email) === email)?.name;

  const rendered = useMemo(() => (effective && notice ? renderMail(effective, notice) : null), [effective, notice]);
  const unresolved = useMemo(() => {
    const seen = new Set<string>();
    return (rendered?.unresolved ?? []).filter((u) => !seen.has(u.name) && !!seen.add(u.name));
  }, [rendered]);
  const usedKeys = useMemo(() => {
    const s = new Set<TemplateFieldKey>();
    for (const sec of effective?.sections ?? []) for (const it of sec.items) if (it.kind !== 'text') s.add(it.fieldKey);
    return s;
  }, [effective]);

  /** 첫 편집 때 선택한 템플릿의 복사본을 만들고, 그 위에 변경을 쌓는다. */
  const edit = (fn: (e: MailEdits) => MailEdits) => {
    if (!working && !template) return;
    setWorking((cur) => fn(startEditing(cur, noticeId, template!, new Date())));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const next = working ? { ...working, updatedAt: new Date().toISOString() } : null;
      const r = await send('mail/prepare', { noticeId, ...(groupId ? { groupId } : {}), templateId, ...(next ? { edits: next } : {}) });
      setDraft(r.draft);
      setNotice(r.notice);
      setEdits(next);
      setWorking(next);
      setDirty(false);
      toast.show('초안을 저장했습니다');
      return true;
    } catch (e) {
      setError(toInfo(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 공고 전용 양식을 지우고 nextTemplateId 템플릿으로 초안을 다시 만든다. */
  const dropEdits = async (nextTemplateId: string) => {
    // 저장된 편집이 없으면 화면의 편집만 버린다.
    if (!edits) { setTplSel(nextTemplateId); setWorking(null); setDirty(false); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await send('mail/prepare', { noticeId, ...(groupId ? { groupId } : {}), templateId: nextTemplateId, edits: null });
      setDraft(r.draft);
      setNotice(r.notice);
      setTplSel(nextTemplateId);
      setEdits(null);
      setWorking(null);
      setDirty(false);
    } catch (e) {
      setError(toInfo(e));
    } finally {
      setSaving(false);
    }
  };

  /** 팝업의 [공고에 저장]/[자동값으로 되돌리기]. 성공하면 화면의 공고를 바꾸고, 초안이 있으면 다시 저장해 본문을 맞춘다. */
  const saveNoticeFields = async (list: NoticeEdit[]): Promise<string | null> => {
    let done = 0;
    try {
      for (const e of list) {
        const r = await send('notice/field-edit', { noticeId, ...e });
        setNotice(r.notice);
        setExtraction(r.extraction);
        done++;
      }
      if (draft) await save();
      else toast.show('공고 값을 저장했습니다');
      return null;
    } catch (e) {
      const { code, message } = toInfo(e);
      const why = code === 'JOB_ALREADY_RUNNING' ? '이 공고는 수집/추출 중입니다. 끝난 뒤 다시 시도하세요.' : `${code ?? ''} ${message}`.trim();
      if (done > 0 && draft) await save();
      return done > 0 ? `${list.length}개 중 ${done}개만 저장했습니다. ${why}` : why;
    }
  };

  const compose = useComposeController({
    noticeId, noticeRef: notice?.ref, jobs,
    params: { ...(groupId ? { groupId } : {}), ...(templateId ? { templateId } : {}) },
    // 저장하지 않은 편집이 있으면 먼저 저장한다. 작성 잡은 저장된 초안을 쓴다.
    beforeStart: async () => (dirty ? save() : true),
  });

  const recordSent = async () => {
    setStatusBusy(true);
    setError(null);
    try {
      const r = await send('mail/sent-add', { noticeId });
      setNotice(r.notice);
      void send('deadline/refresh', { reason: 'manual' }).catch(() => undefined);
    } catch (e) {
      setError(toInfo(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.show(`${label}를 복사했습니다`); } catch { toast.show('복사하지 못했습니다'); }
  };

  const submitRecipient = () => {
    if ((!working && !template) || !rec.data) return;
    const r = addRecipient(startEditing(working, noticeId, template!, new Date()), baseRecipients, addEmail, addRole);
    if (!r.ok) { setAddError(ADD_ERROR[r.reason]); return; }
    setWorking(r.value);
    setDirty(true);
    setAddEmail('');
    setAddError(null);
  };

  const back = from === 'mails' ? (
    <a href={mailsHash()} className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft className="size-4" />메일 관리로 돌아가기</a>
  ) : (
    <a href={`#/review/${encodeURIComponent(noticeId)}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft className="size-4" />공고로 돌아가기</a>
  );

  if (notice === undefined) {
    return <div className="space-y-4">{back}{error ? <FsErrorAlert error={error} onRetry={() => void load()} /> : <Loader2 className="size-4 animate-spin text-muted" />}</div>;
  }
  if (notice === null) {
    return <div className="space-y-4">{back}<InlineAlert tone="warn">공고를 찾을 수 없습니다.</InlineAlert></div>;
  }

  const title = notice.basic.title.value ?? notice.id;
  const isPrespec = noticeKind === 'prespec';
  const noticeNo = isPrespec ? noticeLabel(notice.ref) : `${notice.basic.noticeNo.value ?? notice.ref.noticeNo}-${notice.basic.round.value ?? notice.ref.round ?? '000'}`;
  const saved = notice.attachments.filter((a) => a.status === 'saved');
  const missing = notice.attachments.filter((a) => a.status !== 'saved');
  const excluded = working?.excludedAttachmentIds ?? [];
  const mailStatus = notice.mail.status;
  const noGroup = rec.data !== null && !groupId && !overridden;
  const knownCode = error?.code && CODE_MESSAGE[error.code];
  const draftPath = draft ? `${notice.folder.replace(/\/+$/, '')}/mail-draft.json` : null;
  const locked = saving || compose.view?.kind === 'progress';
  // 그룹 해석 결과가 수신자 편집의 시작점이라, 수신자 목록을 불러오기 전에는 막는다.
  const recLocked = locked || !rec.data;
  const stale = working && tpls.data ? editsStaleness(working, templates.find((t) => t.id === working.base.templateId)) : null;
  const recipientCount = shown.to.length + shown.cc.length;

  // 탭 줄 오른쪽에 붙는 복사 버튼 묶음. 미리보기 제목이 넓게 보이도록 액자 밖에 둔다.
  const copyTools = rendered && (
    <div role="group" aria-label="메일 복사" className="inline-flex items-center gap-0.5 text-sm text-muted">
      <ClipboardCopy aria-hidden className="mr-1 size-4" />
      <span className="mr-1">복사</span>
      {([['제목', rendered.subject], ['HTML', rendered.html], ['텍스트', rendered.text]] as const).map(([label, value]) => (
        <button key={label} type="button" aria-label={`${label} 복사`} className="rounded-ctl px-2 py-1 font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink" onClick={() => void copy(value, label)}>
          {label}
        </button>
      ))}
    </div>
  );
  const shownSaved = showAllFiles ? saved : saved.slice(0, FILE_PREVIEW);
  const tabCls = (on: boolean) => `rounded-ctl px-3.5 py-1.5 text-sm font-semibold transition-colors ${on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`;

  return (
    <div className="space-y-5">
      {back}
      {/* 제목이 한 줄을 넓게 쓰도록 상태·발송 정보는 제목 아래 메타 줄로 모은다. */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[32rem]">
          <h1 className="title-mark text-2xl leading-snug font-bold tracking-tight text-balance">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[calc(3px+0.75rem)] text-sm text-muted">
            <span className="font-mono">{noticeNo}</span>
            {isPrespec && <StatusBadge status="idle">사전규격</StatusBadge>}
            <span aria-hidden className="text-faint">·</span>
            <StatusBadge status={STATUS_TONE[mailStatus]}>{STATUS_LABEL[mailStatus]}</StatusBadge>
            {notice.mail.deliveredAt && (
              <span>
                마지막 발송 <span className="font-mono tabular-nums">{formatDateTime(notice.mail.deliveredAt)}</span>
                <a href={noticeHash(notice.id, 'history')} className="ml-2 text-accent hover:underline">이력 보기</a>
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" className="shrink-0" loading={statusBusy} disabled={saving} icon={<Check />} onClick={() => void recordSent()}>{mailStatus === 'delivered' ? '발송 1회 더 기록' : '발송 완료로 기록'}</Button>
      </header>

      {from === 'collect' && (
        <InlineAlert tone="info">수집이 끝났습니다. 보낼 내용을 확인하고 필요한 항목(예: 제안PM)을 채운 뒤 [{PROVIDER_LABEL[provider]}로 작성]을 누르세요.</InlineAlert>
      )}
      {stale && (
        <InlineAlert tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{stale === 'missing' ? '원본 템플릿이 삭제되었습니다.' : '원본 템플릿이 변경되었습니다.'} 이 공고 양식은 처음 고칠 때의 복사본입니다.</span>
            {stale === 'changed' && <Button variant="secondary" icon={<RotateCcw />} disabled={locked} onClick={() => setConfirm({ kind: 'reset' })}>원본 양식으로 초기화</Button>}
          </div>
        </InlineAlert>
      )}
      {knownCode ? <InlineAlert tone="error">{knownCode}</InlineAlert> : <FsErrorAlert error={error} onRetry={() => void load()} />}
      {rec.error && <FsErrorAlert error={rec.error} onRetry={() => void rec.reload()} />}
      {tpls.error && <FsErrorAlert error={tpls.error} onRetry={() => void tpls.reload()} />}
      {noGroup && (
        <InlineAlert tone="warn">
          기본 수신자 그룹이 없습니다. <a href="#/recipients" className="text-accent underline">수신자 화면</a>에서 그룹을 만들고 기본으로 지정하거나, 오른쪽 수신자 칸에 주소를 직접 넣으세요.
        </InlineAlert>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <label className="block w-full space-y-1.5 text-sm font-semibold text-ink sm:w-60">
          <span className="block">수신자 그룹</span>
          <Select
            className="font-normal"
            value={groupId}
            placeholder="(선택 없음)"
            disabled={overridden || locked}
            onChange={setGroupSel}
            options={groups.map((g) => ({ value: g.id, label: g.name, hint: g.isDefault ? '기본' : undefined }))}
          />
        </label>
        <label className="block w-full space-y-1.5 text-sm font-semibold text-ink sm:w-60">
          <span className="flex items-baseline justify-between gap-2">템플릿{working && <span className="text-xs font-normal text-accent">이 공고 전용 양식</span>}</span>
          <Select
            className="font-normal"
            value={templateId}
            disabled={locked}
            onChange={(id) => { if (id === templateId) return; if (working) setConfirm({ kind: 'switch', templateId: id }); else setTplSel(id); }}
            options={[
              ...sameKind.map((t) => ({ value: t.id, label: t.name, hint: t.isDefault ? '기본' : undefined })),
              ...otherKind.map((t) => ({ value: t.id, label: t.name, group: '(다른 종류)', hint: t.isDefault ? '기본' : undefined })),
            ]}
          />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty && <Button variant="ghost" icon={<RotateCcw />} disabled={locked} onClick={() => { setWorking(edits); setDirty(false); }}>변경 취소</Button>}
          <Button variant={dirty ? 'secondary' : 'ghost'} loading={saving} disabled={statusBusy || !templateId || (!groupId && !overridden) || compose.view?.kind === 'progress'} icon={<Save />} onClick={() => void save()}>
            {dirty ? '변경 저장' : '초안 저장'}
          </Button>
          <ComposeStartButton ctl={compose} label={`${PROVIDER_LABEL[provider]}로 작성`} />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="@container min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="메일 보기" className="inline-flex gap-0.5 rounded-ctl border border-line bg-sunken p-0.5">
            <button type="button" role="tab" aria-selected={tab === 'edit'} className={tabCls(tab === 'edit')} onClick={() => setTab('edit')}>내용 편집{dirty && <span aria-label="저장 안 됨" className="ml-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-warn" />}</button>
            <button type="button" role="tab" aria-selected={tab === 'preview'} className={tabCls(tab === 'preview')} onClick={() => setTab('preview')}>미리보기</button>
          </div>
          {copyTools}
          </div>

          {tab === 'preview' && (rendered ? <MailPreviewFrame fill height={720} html={rendered.html} subject={rendered.subject} /> : <Loader2 className="size-4 animate-spin text-muted" />)}

          {tab === 'edit' && effective && (
            <div className="grid items-start gap-4 @5xl:grid-cols-2">
            <fieldset disabled={locked} className="min-w-0 space-y-4">
              <p className="text-sm text-muted">여기서 고친 내용은 이 공고 메일에만 적용되고 원본 템플릿은 바뀌지 않습니다.</p>
              <Card title="제목과 인사말">
                <Field label="제목" htmlFor="mail-subject" help="{공고명} 같은 변수를 그대로 쓸 수 있습니다.">
                  <input id="mail-subject" className={inputClass} value={effective.subject} onChange={(e) => edit((x) => patchTemplate(x, { subject: e.target.value }))} />
                </Field>
                <Field label="인사말" htmlFor="mail-greeting">
                  <textarea id="mail-greeting" rows={3} className={inputClass} value={effective.greeting} onChange={(e) => edit((x) => patchTemplate(x, { greeting: e.target.value }))} />
                </Field>
              </Card>

              <Card
                title="섹션"
                description="공고 값 항목은 연필 버튼으로 이 메일에서만 값을 고칠 수 있습니다."
                action={
                  <Button variant="secondary" icon={<Plus />} onClick={() => edit((x) => patchTemplate(x, { sections: [...x.template.sections, { id: `sec_${crypto.randomUUID().slice(0, 8)}`, title: '새 섹션', items: [] }] }))}>
                    섹션 추가
                  </Button>
                }
              >
                {effective.sections.length === 0 && <p className="text-sm text-muted">섹션이 없습니다.</p>}
                {effective.sections.map((s, i) => (
                  <SectionEditor
                    key={s.id}
                    section={s}
                    index={i}
                    kind={kindOf(notice.ref)}
                    usedKeys={usedKeys}
                    onChange={(next) => edit((x) => patchTemplate(x, { sections: x.template.sections.map((y) => (y.id === s.id ? next : y)) }))}
                    onRemove={() => edit((x) => patchTemplate(x, { sections: x.template.sections.filter((y) => y.id !== s.id) }))}
                    onMoveUp={i > 0 ? () => edit((x) => patchTemplate(x, { sections: swap(x.template.sections, i, i - 1) })) : undefined}
                    onMoveDown={i < effective.sections.length - 1 ? () => edit((x) => patchTemplate(x, { sections: swap(x.template.sections, i, i + 1) })) : undefined}
                    onFocusInput={() => undefined}
                    onConvertToText={(j) => edit((x) => convertItem(x, s.id, j, notice, new Date()))}
                    onRevertToField={(j) => edit((x) => revertItem(x, s.id, j))}
                  />
                ))}
              </Card>

              <Card title="맺음말">
                <textarea aria-label="맺음말" rows={3} className={inputClass} value={effective.closing} onChange={(e) => edit((x) => patchTemplate(x, { closing: e.target.value }))} />
              </Card>
            </fieldset>
            {/* 편집하면서 결과를 바로 보도록 옆(좁으면 아래)에 미리보기를 붙인다. */}
            <div className="min-w-0 @5xl:sticky @5xl:top-6">
              {rendered ? <MailPreviewFrame fill height={640} html={rendered.html} subject={rendered.subject} /> : <Loader2 className="size-4 animate-spin text-muted" />}
            </div>
            </div>
          )}
        </div>

        <aside className="divide-y divide-line rounded-card border border-line bg-surface shadow-card xl:sticky xl:top-6">
          {/* 작성 전에는 서비스가 무엇을 채우는지 안내하고, 시작하면 진행 상태로 바뀐다. */}
          <PanelSection title={`${PROVIDER_LABEL[provider]} 작성`}>
            {compose.view || compose.note ? (
              <ComposeStatus ctl={compose} detached />
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                {provider === 'gmail'
                  ? '작성 창을 열고 받는 사람, 참조, 제목, 본문(서식 없음)을 채웁니다. 첨부와 서식 본문은 직접 넣어 주세요.'
                  : '작성 창을 열고 받는 사람, 참조, 제목, 본문, 첨부를 채웁니다. 내용을 확인하고 보내기만 누르세요.'}
              </p>
            )}
          </PanelSection>

          <PanelSection title="수신자" meta={`TO ${shown.to.length}, CC ${shown.cc.length}`} metaTone={recipientCount === 0 ? 'text-danger' : 'text-muted'}>
            <div className="space-y-2.5 text-sm">
              {overridden && (
                <p className="text-xs text-muted">
                  이 공고에서만 바꾼 수신자입니다.{' '}
                  <button type="button" disabled={recLocked} className="font-semibold text-accent hover:underline" onClick={() => edit(resetRecipients)}>그룹으로 되돌리기</button>
                </p>
              )}
              {!overridden && !resolved && <p className="text-xs text-muted">그룹을 고르거나 아래에 주소를 넣으세요.</p>}
              {ROLES.map((role) => (
                <div key={role} className="flex items-start gap-2">
                  <span className="w-7 shrink-0 pt-1 font-mono text-xs font-semibold text-muted">{role.toUpperCase()}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {shown[role].map((email) => (
                      <span key={email} className="inline-flex items-center gap-0.5 rounded-ctl border border-line bg-sunken py-0.5 pr-0.5 pl-2 text-xs" title={email}>
                        {nameOf(email) || email}
                        <button type="button" aria-label={`${nameOf(email) || email} 빼기`} disabled={recLocked} className="rounded-ctl p-0.5 text-faint hover:bg-surface hover:text-ink" onClick={() => edit((x) => removeRecipient(x, baseRecipients, email))}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    {shown[role].length === 0 && <span className="pt-1 text-xs text-faint">없음</span>}
                  </div>
                </div>
              ))}
              <form className="space-y-1.5 border-t border-line pt-2.5" onSubmit={(e) => { e.preventDefault(); submitRecipient(); }}>
                <div className="flex gap-1.5">
                  <div className="inline-flex shrink-0 rounded-ctl border border-line bg-sunken p-0.5" role="group" aria-label="받는 방식">
                    {ROLES.map((role) => (
                      <button key={role} type="button" aria-pressed={addRole === role} className={`rounded-ctl px-2 font-mono text-xs font-semibold ${addRole === role ? 'bg-surface text-ink shadow-card' : 'text-muted'}`} onClick={() => setAddRole(role)}>
                        {role.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="추가할 수신자 이메일"
                    list="mail-recipient-options"
                    placeholder="이름 또는 이메일"
                    className={`${inputClass} min-w-0`}
                    disabled={recLocked}
                    value={addEmail}
                    onChange={(e) => { setAddEmail(e.target.value); setAddError(null); }}
                  />
                  <Button type="submit" variant="secondary" size="icon" aria-label="수신자 추가" disabled={recLocked || !addEmail.trim()} icon={<Plus />} />
                </div>
                <datalist id="mail-recipient-options">
                  {(rec.data?.recipients ?? []).filter((r) => r.enabled).map((r) => <option key={r.id} value={r.email}>{r.name}</option>)}
                </datalist>
                {addError && <p className="text-xs text-danger">{addError}</p>}
              </form>
              {!overridden && resolved && resolved.skipped.length > 0 && (
                <div className="border-t border-line pt-2.5">
                  <p className="text-xs font-semibold text-muted">제외 {resolved.skipped.length}명</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-muted">
                    {resolved.skipped.map((s, i) => <li key={`${s.id}-${i}`}>{s.name || s.email || s.id} ({SKIP_LABEL[s.reason]})</li>)}
                  </ul>
                </div>
              )}
            </div>
          </PanelSection>

          <PanelSection
            title="첨부파일"
            meta={notice.attachments.length > 0 ? `${saved.length}/${notice.attachments.length} 확보` : undefined}
            metaTone={missing.length > 0 ? 'text-danger' : 'text-ok'}
          >
            <div className="space-y-2.5 text-sm">
              {saved.length === 0 && missing.length === 0 && <p className="text-muted">첨부파일이 없습니다.</p>}
              {saved.length > 0 && (
                <ul className="space-y-1 text-xs text-muted">
                  {shownSaved.map((a) => {
                    const off = excluded.includes(a.id);
                    const name = a.savedName ?? a.originalName;
                    return (
                      <li key={a.id}>
                        <label className="flex items-baseline gap-1.5" title={off ? `${name} (보내지 않음)` : name}>
                          <input type="checkbox" checked={!off} disabled={locked} aria-label={`${name} 첨부`} className="size-3.5 shrink-0 translate-y-0.5 accent-[var(--color-accent)]" onChange={() => edit((x) => toggleAttachment(x, a.id))} />
                          <span className={`min-w-0 truncate ${off ? 'text-faint line-through' : ''}`}>{name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {excluded.length > 0 && <p className="text-xs text-muted">{excluded.length}개는 이 메일에 첨부하지 않습니다.</p>}
              {saved.length > FILE_PREVIEW && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowAllFiles((v) => !v)}>
                  {showAllFiles ? '접기' : `${saved.length - FILE_PREVIEW}개 더 보기`}
                </button>
              )}
              {missing.length > 0 && (
                <div className="border-t border-line pt-2.5">
                  <p className="text-xs font-semibold text-danger">미확보 {missing.length}개</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-danger">
                    {missing.map((a) => <li key={a.id} className="wrap-anywhere">{a.originalName}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </PanelSection>

          {unresolved.length > 0 && (
            <PanelSection title="확인 필요" meta={`${unresolved.length}개`} metaTone="text-warn">
              <ul className="space-y-1.5 text-sm">
                {unresolved.map((u) => (
                  <li key={u.name} className="flex items-baseline justify-between gap-3">
                    <button type="button" className="min-w-0 truncate text-left text-accent hover:underline" onClick={() => setResolving(u)}>{u.label}</button>
                    <span className="shrink-0 text-xs text-muted">{u.status === 'missing' ? '값 없음' : '확인 필요'}</span>
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

          {draftPath && (
            <PanelSection title="초안 파일">
              <p className="font-mono text-xs wrap-anywhere text-muted">{draftPath}</p>
            </PanelSection>
          )}
        </aside>
      </div>

      {resolving && (() => {
        // {custom.키}는 레지스트리에 없고 이름이 곧 필드 키다.
        const fieldKey = VARIABLE_BY_NAME.get(resolving.name)?.fieldKey ?? (isTemplateFieldKey(resolving.name) ? resolving.name : undefined);
        if (!fieldKey) return null;
        return (
          <ResolveDialog
            noticeId={noticeId} notice={notice} extraction={extraction} item={resolving} fieldKey={fieldKey}
            onApplyMail={locked || (!working && !template) ? undefined : (text) => { edit((x) => overrideValue(x, fieldKey, resolving.name, text, notice, new Date())); toast.show(`이 메일의 ${resolving.label} 값을 바꿨습니다. 저장해야 초안에 반영됩니다`); }}
            onSaveNotice={locked ? undefined : saveNoticeFields}
            onClose={() => setResolving(null)}
          />
        );
      })()}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'reset' ? '원본 양식으로 초기화할까요?' : '이 공고 양식 편집 내용을 버릴까요?'}
        description="이 공고에서 고친 제목, 항목, 수신자, 첨부 선택이 모두 사라집니다."
        confirmLabel={confirm?.kind === 'reset' ? '초기화' : '버리고 바꾸기'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === 'switch') void dropEdits(c.templateId);
          else if (c?.kind === 'reset' && working) void dropEdits(working.base.templateId);
        }}
      />
      {toast.node}
    </div>
  );
}
