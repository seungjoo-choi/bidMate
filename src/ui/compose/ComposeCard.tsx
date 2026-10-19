import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Mail, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job } from '../../core/types/job';
import type { NoticeRef } from '../../core/types/notice';
import type { MailDraft } from '../../core/types/mail';
import { composeHost, originOf, PROVIDER_LABEL } from '../../core/model/mail-provider';
import { withDefaults } from '../../core/model/default-settings';
import type { Settings } from '../../core/types/settings';
import { send } from '../../messaging/bus';
import { Button, InlineAlert, StatusBadge } from '../components';
import { copyRich, copyText } from '../clipboard';
import { composeView, type CopyKind } from '../compose-view';

const COPY_LABEL: Record<CopyKind, string> = {
  to: '받는사람', cc: '참조', subject: '제목', body: '본문(서식)', attach: '첨부 폴더',
};
const FIELD_LABEL: Record<string, string> = { to: '받는사람', cc: '참조', subject: '제목', body: '본문' };
const FIELD_STATUS: Record<string, string> = { mismatch: '내용 불일치', failed: '실패', unsupported: '자동 입력 불가' };
const ATTACH_STATUS: Record<string, string> = {
  uploading_timeout: '업로드 시간 초과', failed: '실패', not_in_dom: '목록에 없음', size_mismatch: '크기 불일치', skipped: '건너뜀',
};

/** 웹메일 호스트와 접근 권한. 클릭 시 첫 await로 권한을 요청해야 하므로 미리 구해 둔다. */
function useWebmailPermission(): { origin: string | null; granted: boolean | null } {
  const [origin, setOrigin] = useState<string | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const check = async () => {
      const my = ++seq;
      const { settingsCache } = await chrome.storage.local.get('settingsCache');
      const o = originOf(composeHost(withDefaults(settingsCache as Settings | undefined)));
      const ok = await chrome.permissions.contains({ origins: [o] }).catch(() => false);
      if (alive && my === seq) { setOrigin(o); setGranted(ok); }
    };
    void check();
    const onChange = () => void check();
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.settingsCache) void check();
    };
    chrome.storage.onChanged.addListener(onStorage);
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);
  return { origin, granted };
}

export interface ComposeProps {
  noticeId: string; noticeRef?: NoticeRef; params?: { groupId?: string; templateId?: string }; jobs: Job[];
  /** 권한 확인 뒤, 잡 시작 직전에 부른다. false면 시작하지 않는다(예: 저장 안 된 편집 저장). */
  beforeStart?: () => Promise<boolean>;
}
export type ComposeController = ReturnType<typeof useComposeController>;

/** compose 잡 상태와 시작·복사·탭 이동 동작. 시작 버튼과 상태 표시를 따로 배치할 때 쓴다. */
export function useComposeController({ noticeId, noticeRef, params, jobs, beforeStart }: ComposeProps) {
  const { origin, granted } = useWebmailPermission();
  const job = jobs.find((j) => j.type === 'compose' && j.noticeId === noticeId) ?? null;
  const view = composeView(job);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [rootName, setRootName] = useState<string | undefined>();
  const [copied, setCopied] = useState<CopyKind | null>(null);

  const needsCopy = view?.kind === 'manual' || view?.kind === 'partial' || view?.kind === 'url';
  useEffect(() => {
    setCopied(null);
    if (!needsCopy) return;
    let alive = true;
    send('mail/draft-get', { noticeId }).then((d) => { if (alive) setDraft(d); }, () => undefined);
    send('fs/status', undefined).then((s) => { if (alive) setRootName(s.rootName); }, () => undefined);
    return () => { alive = false; };
  }, [needsCopy, noticeId, job?.id]);

  // 사용자 제스처 안에서 첫 await로 permissions.request를 호출한다.
  const start = async (retryOf?: string) => {
    setNote(null);
    if (!granted) {
      if (!origin) return;
      const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
      if (!ok) { setNote('웹메일 접근이 허용되지 않았습니다'); return; }
    }
    setBusy(true);
    try {
      if (beforeStart && !(await beforeStart())) return;
      await send('job/start', { type: 'compose', noticeId, ...(noticeRef ? { ref: noticeRef } : {}), params: params ?? {}, ...(retryOf ? { retryOf } : {}) });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const focusTab = async () => {
    if (job?.composeTabId === undefined) return;
    try {
      const t = await chrome.tabs.update(job.composeTabId, { active: true });
      if (t?.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
    } catch { setNote('웹메일 탭을 찾을 수 없습니다'); }
  };

  const attachPath = () => {
    const dir = view && 'attachDir' in view ? view.attachDir : undefined;
    return dir ? (rootName ? `${rootName}/${dir}` : dir) : '';
  };

  /** 복사 행에 보여 줄 값 요약. 비어 있으면 빈 문자열. */
  const preview = (k: CopyKind): string => {
    if (k === 'attach') return attachPath();
    if (!draft) return '';
    if (k === 'to') return draft.to.join('; ');
    if (k === 'cc') return draft.cc.join('; ');
    if (k === 'subject') return draft.subject;
    return draft.text.replace(/\s+/g, ' ').trim();
  };

  const copy = async (k: CopyKind) => {
    if (!draft && k !== 'attach') return;
    try {
      if (k === 'to') await copyText(draft!.to.join('; '));
      else if (k === 'cc') await copyText(draft!.cc.join('; '));
      else if (k === 'subject') await copyText(draft!.subject);
      else if (k === 'body') await copyRich(draft!.html, draft!.text);
      else {
        const path = attachPath();
        if (!path) return;
        await copyText(path);
      }
      setCopied(k);
    } catch { setNote('클립보드에 복사하지 못했습니다'); }
  };

  return { job, view, busy, note, draft, copied, granted, start, focusTab, copy, preview };
}

/**
 * 메일 작성 시작 버튼. 진행 중에는 막고, 한 번 작성한 뒤에는 다시 작성으로 바뀐다.
 * 오류 상태에서는 ComposeStatus의 조치 버튼(다시 시도 등)만 쓰도록 막는다.
 */
export function ComposeStartButton({ ctl, label = '메일 작성', className = '' }: { ctl: ComposeController; label?: string; className?: string }) {
  const { view, busy, granted, start } = ctl;
  const again = view !== null && view.kind !== 'error';
  return (
    <Button className={className} variant={again ? 'secondary' : 'primary'} icon={<Mail />} loading={busy}
      disabled={granted === null || view?.kind === 'progress' || view?.kind === 'error'} onClick={() => void start()}>
      {granted === false ? `웹메일 접근 허용 후 ${label}` : again ? '다시 작성' : label}
    </Button>
  );
}

/**
 * compose 잡 상태 표시. detached면 시작 버튼이 바깥(ComposeStartButton)에 있으므로
 * 잡이 없을 때 아무것도 그리지 않고 상태별 다시 작성 버튼도 뺀다.
 */
export function ComposeStatus({ ctl, detached = false }: { ctl: ComposeController; detached?: boolean }) {
  const { job, view, busy, note, draft, copied, granted, start, focusTab, copy, preview } = ctl;
  const retryBtn = !detached && (
    <Button className="w-full" variant="ghost" loading={busy} onClick={() => void start()}>다시 작성</Button>
  );

  const focusBtn = (canFocus: boolean) => canFocus && (
    <Button className="w-full" variant="secondary" icon={<ExternalLink />} onClick={() => void focusTab()}>작성 탭으로 이동</Button>
  );
  // 항목마다 값을 보여 주는 복사 행. 누르면 그 값을 복사하고 체크로 바뀐다.
  const copyBtns = (kinds: CopyKind[]) => kinds.length > 0 && (
    <div className="divide-y divide-line overflow-hidden rounded-ctl border border-line">
      {kinds.map((k) => {
        const value = preview(k);
        const done = copied === k;
        return (
          <button key={k} type="button" disabled={k !== 'attach' && !draft} title={value || undefined} aria-label={`${COPY_LABEL[k]} 복사`}
            className="group flex w-full items-center gap-3 bg-sunken px-3 py-2 text-left text-sm transition-colors hover:bg-select disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void copy(k)}>
            <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-muted">{COPY_LABEL[k]}</span>
            <span className={`min-w-0 flex-1 truncate ${value ? 'text-ink' : 'text-faint'}`}>{value || '없음'}</span>
            {done
              ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ok"><Check className="size-4" />복사됨</span>
              : <Copy className="size-4 shrink-0 text-faint transition-colors group-hover:text-ink" />}
          </button>
        );
      })}
    </div>
  );

  let body;
  if (!view) {
    body = detached ? null : (
      <Button className="w-full" icon={<Mail />} loading={busy} disabled={granted === null} onClick={() => void start()}>
        {granted === false ? '웹메일 접근 허용 후 메일 작성' : '메일 작성'}
      </Button>
    );
  } else if (view.kind === 'progress') {
    body = (
      <div className="space-y-2.5">
        <div className="break-all text-sm">{view.label}{view.attach ? ` (${view.attach.done}/${view.attach.total})` : ''}</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(view.ratio * 100)}%`, transition: 'width 200ms' }} />
        </div>
        <div className="flex items-center justify-end gap-2">
          {view.cancelling ? (
            <>
              <span className="text-sm text-warn">취소 중…</span>
              <Button variant="ghost" onClick={() => job && void send('job/cancel', { jobId: job.id, force: true }).catch(() => undefined)}>강제 중단</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => job && void send('job/cancel', { jobId: job.id, force: false }).catch(() => undefined)}>취소</Button>
          )}
        </div>
        {focusBtn(view.canFocus)}
      </div>
    );
  } else if (view.kind === 'done') {
    body = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />
          <div className="font-semibold">메일 작성 완료. 웹메일에서 내용을 확인한 뒤 직접 보내 주세요</div>
        </div>
        {focusBtn(view.canFocus)}
        {retryBtn}
      </div>
    );
  } else if (view.kind === 'manual') {
    body = (
      <div className="space-y-3">
        <InlineAlert tone="warn">웹메일 탭을 열었습니다. 자동 입력은 아직 검증되지 않아 직접 붙여 넣어야 합니다</InlineAlert>
        {copyBtns(view.copies)}
        {focusBtn(view.canFocus)}
        {retryBtn}
      </div>
    );
  } else if (view.kind === 'partial') {
    body = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="font-semibold">일부 항목을 직접 입력해야 합니다</div>
        </div>
        <ul className="space-y-1.5">
          {view.fields.map((f) => (
            <li key={f.field} className="flex items-center justify-between gap-2 text-sm">
              <span>{FIELD_LABEL[f.field]}</span>
              <StatusBadge status="warn">{FIELD_STATUS[f.status] ?? f.status}</StatusBadge>
            </li>
          ))}
          {view.attachments.map((a) => (
            <li key={a.fileId} className="flex items-start justify-between gap-2 text-sm">
              <span className="min-w-0 truncate" title={a.error ?? a.name}>{a.name}</span>
              <StatusBadge status={a.status === 'skipped' ? 'idle' : 'error'}>{ATTACH_STATUS[a.status] ?? a.status}</StatusBadge>
            </li>
          ))}
        </ul>
        {view.attachments.length > 0 && view.attachDir && (
          <p className="text-sm text-muted">첨부: 탐색기에서 <span className="font-mono">{view.attachDir}</span>의 파일을 첨부 영역에 끌어다 놓으세요</p>
        )}
        {copyBtns(view.copies)}
        {focusBtn(view.canFocus)}
      </div>
    );
  } else if (view.kind === 'url') {
    body = (
      <div className="space-y-3">
        <InlineAlert tone="info">{PROVIDER_LABEL[view.provider]} 작성 창을 열었습니다. {view.prefilled.map((f) => FIELD_LABEL[f.field]).join(', ')}은(는) 주소로 전달했습니다. 화면에서 내용을 확인하세요.</InlineAlert>
        {view.pending.some((f) => f.field === 'body') && (
          <InlineAlert tone="warn">
            {view.pending.some((f) => f.field === 'body' && f.error === 'URL_TOO_LONG')
              ? '본문이 길어 주소로 넣지 못했습니다. [본문 복사(서식)] 후 붙여 넣으세요.'
              : '본문은 [본문 복사(서식)] 후 작성 창 본문에 붙여 넣으세요.'}
          </InlineAlert>
        )}
        {view.attachments.length > 0 && view.attachDir && (
          <p className="text-sm text-muted">첨부: 탐색기에서 <span className="font-mono">{view.attachDir}</span>의 파일을 첨부 영역에 끌어다 놓으세요</p>
        )}
        {copyBtns(view.copies)}
        {focusBtn(view.canFocus)}
        {retryBtn}
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{view.message}</div>
            {view.detail && <div className="mt-0.5 break-all text-sm text-muted">{view.detail}</div>}
          </div>
        </div>
        {view.action !== 'none' && (
          <Button className="w-full" loading={busy} onClick={() => {
            if (view.action === 'settings') void send('ui/open', view.fix ?? { page: 'settings' }).catch(() => undefined);
            else if (view.action === 'grant-fs') void send('ui/open', { page: 'grant' }).catch(() => undefined);
            else if (view.action === 'recipients') void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/recipients') });
            else void start(job?.id);   // grant-site는 start 안에서 권한부터 요청한다
          }}>{view.actionLabel}</Button>
        )}
      </div>
    );
  }

  if (!body && !note) return null;
  return (
    <div className="space-y-3">
      {body}
      {note && <InlineAlert tone="error">{note}</InlineAlert>}
    </div>
  );
}

/** 수집이 끝난 공고의 메일 작성 진입과 compose 잡 상태. */
export function ComposeCard(props: ComposeProps) {
  return <ComposeStatus ctl={useComposeController(props)} />;
}
