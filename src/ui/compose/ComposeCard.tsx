import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Mail, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job } from '../../core/types/job';
import type { NoticeRef } from '../../core/types/notice';
import type { MailDraft } from '../../core/types/mail';
import { getWebmailHost } from '../../background/site-registry';
import { send } from '../../messaging/bus';
import { Button, InlineAlert, StatusBadge } from '../components';
import { copyRich, copyText } from '../clipboard';
import { composeView, type CopyKind } from '../compose-view';

const COPY_LABEL: Record<CopyKind, string> = {
  to: '수신자 복사', cc: '참조 복사', subject: '제목 복사', body: '본문 복사(서식)', attach: '첨부 폴더 경로 복사',
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
    const check = async () => {
      const o = `https://${await getWebmailHost()}/*`;
      const ok = await chrome.permissions.contains({ origins: [o] }).catch(() => false);
      if (alive) { setOrigin(o); setGranted(ok); }
    };
    void check();
    const onChange = () => void check();
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      alive = false;
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);
  return { origin, granted };
}

/** 수집이 끝난 공고의 메일 작성 진입과 compose 잡 상태. */
export function ComposeCard({ noticeId, noticeRef, params, jobs }: {
  noticeId: string; noticeRef?: NoticeRef; params?: { groupId?: string; templateId?: string }; jobs: Job[];
}) {
  const { origin, granted } = useWebmailPermission();
  const job = jobs.find((j) => j.type === 'compose' && j.noticeId === noticeId) ?? null;
  const view = composeView(job);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [rootName, setRootName] = useState<string | undefined>();
  const [copied, setCopied] = useState<CopyKind | null>(null);

  const needsCopy = view?.kind === 'manual' || view?.kind === 'partial';
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

  const copy = async (k: CopyKind) => {
    if (!draft && k !== 'attach') return;
    try {
      if (k === 'to') await copyText(draft!.to.join('; '));
      else if (k === 'cc') await copyText(draft!.cc.join('; '));
      else if (k === 'subject') await copyText(draft!.subject);
      else if (k === 'body') await copyRich(draft!.html, draft!.text);
      else {
        const dir = view && 'attachDir' in view ? view.attachDir : undefined;
        if (!dir) return;
        await copyText(rootName ? `${rootName}/${dir}` : dir);
      }
      setCopied(k);
    } catch { setNote('클립보드에 복사하지 못했습니다'); }
  };

  const focusBtn = (canFocus: boolean) => canFocus && (
    <Button className="w-full" variant="secondary" icon={<ExternalLink />} onClick={() => void focusTab()}>작성 탭으로 이동</Button>
  );
  const copyBtns = (kinds: CopyKind[]) => kinds.length > 0 && (
    <div className="grid grid-cols-2 gap-2">
      {kinds.map((k) => (
        <Button key={k} variant="ghost" icon={<Copy />} disabled={k !== 'attach' && !draft} onClick={() => void copy(k)}
          className={k === 'attach' ? 'col-span-2' : ''}>
          {copied === k ? '복사됨' : COPY_LABEL[k]}
        </Button>
      ))}
    </div>
  );

  let body;
  if (!view) {
    body = (
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
        <Button className="w-full" variant="ghost" loading={busy} onClick={() => void start()}>다시 작성</Button>
      </div>
    );
  } else if (view.kind === 'manual') {
    body = (
      <div className="space-y-3">
        <InlineAlert tone="warn">웹메일 탭을 열었습니다. 자동 입력은 아직 검증되지 않아 직접 붙여 넣어야 합니다</InlineAlert>
        {copyBtns(view.copies)}
        {focusBtn(view.canFocus)}
        <Button className="w-full" variant="ghost" loading={busy} onClick={() => void start()}>다시 작성</Button>
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
            if (view.action === 'settings') void send('ui/open', { page: 'settings' }).catch(() => undefined);
            else if (view.action === 'grant-fs') void send('ui/open', { page: 'grant' }).catch(() => undefined);
            else if (view.action === 'recipients') void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/recipients') });
            else void start(job?.id);   // grant-site는 start 안에서 권한부터 요청한다
          }}>{view.actionLabel}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {body}
      {note && <InlineAlert tone="error">{note}</InlineAlert>}
    </div>
  );
}
