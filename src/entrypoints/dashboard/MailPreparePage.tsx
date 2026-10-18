import { ArrowLeft, Check, ClipboardCopy, Loader2, Save, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { resolveRecipients } from '../../core/recipients/resolve';
import { renderMail } from '../../core/templates/render';
import type { MailDraft } from '../../core/types/mail';
import type { MailStatus, Notice } from '../../core/types/notice';
import { send } from '../../messaging/bus';
import { Button, Card, InlineAlert, StatusBadge, Select, useToast, type BadgeStatus } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useRecipients, useTemplates } from '../../ui/hooks/useConfig';
import { FsErrorAlert, type FsErrorInfo } from './FsErrorAlert';
import { ComposeCard } from '../../ui/compose/ComposeCard';
import { useJobs } from '../../ui/hooks/useJobs';
import { useSettings } from '../../ui/hooks/useSettings';
import { composeProvider, PROVIDER_LABEL } from '../../core/model/mail-provider';
import { MailPreviewFrame } from './templates/MailPreviewFrame';

const STATUS_LABEL: Record<MailStatus, string> = { none: '초안 없음', drafting: '초안 작성됨', ready_for_review: '검토 대기', delivered: '전달 완료' };
const STATUS_TONE: Record<MailStatus, BadgeStatus> = { none: 'idle', drafting: 'warn', ready_for_review: 'warn', delivered: 'ok' };
const SKIP_LABEL = { missing: '없음', disabled: '사용 안 함', duplicate: '중복' } as const;
const CODE_MESSAGE: Record<string, string> = {
  NO_GROUP: '수신자 그룹을 선택해 주세요.',
  NO_RECIPIENTS: '선택한 그룹에 보낼 수 있는 수신자가 없습니다.',
  JOB_ALREADY_RUNNING: '이 공고의 수집이나 추출이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.',
  GROUP_NOT_FOUND: '자동 작성 설정의 그룹이 삭제되었습니다.',
  TEMPLATE_NOT_FOUND: '자동 작성 설정의 템플릿이 삭제되었습니다.',
  NOT_FOUND: '공고 또는 그룹/템플릿을 찾을 수 없습니다.',
};

const toInfo = (e: unknown): FsErrorInfo => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

export function MailPreparePage({ noticeId }: { noticeId: string }) {
  const [notice, setNotice] = useState<Notice | null | undefined>(undefined);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [error, setError] = useState<FsErrorInfo | null>(null);
  const [groupSel, setGroupSel] = useState<string | null>(null);
  const [tplSel, setTplSel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const toast = useToast();
  const rec = useRecipients();
  const tpls = useTemplates();
  const jobs = useJobs();
  const { settings: mailSettings } = useSettings();
  const provider = mailSettings ? composeProvider(mailSettings) : 'naverworks';

  const load = async () => {
    try {
      const r = await send('notice/get', { noticeId });
      setNotice(r ? r.notice : null);
      setDraft(await send('mail/draft-get', { noticeId }));
      setError(null);
    } catch (e) {
      setError(toInfo(e));
    }
  };
  useEffect(() => { void load(); }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = rec.data?.groups ?? [];
  const templates = tpls.data?.templates ?? [];
  const groupId = groupSel ?? (groups.find((g) => g.id === notice?.mail.groupId) ?? groups.find((g) => g.isDefault))?.id ?? '';
  const templateId = tplSel ?? (templates.find((t) => t.id === notice?.mail.templateId) ?? templates.find((t) => t.isDefault) ?? templates[0])?.id ?? '';
  const group = groups.find((g) => g.id === groupId);
  const template = templates.find((t) => t.id === templateId);

  const resolved = useMemo(() => (group && rec.data ? resolveRecipients(group, rec.data.recipients) : null), [group, rec.data]);
  const rendered = useMemo(() => (template && notice ? renderMail(template, notice) : null), [template, notice]);
  const unresolved = useMemo(() => {
    const seen = new Set<string>();
    return (rendered?.unresolved ?? []).filter((u) => !seen.has(u.name) && !!seen.add(u.name));
  }, [rendered]);

  const prepare = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await send('mail/prepare', { noticeId, groupId, templateId });
      setDraft(r.draft);
      setNotice(r.notice);
      toast.show('초안을 저장했습니다');
    } catch (e) {
      setError(toInfo(e));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'delivered' | 'none') => {
    setStatusBusy(true);
    setError(null);
    try {
      const r = await send('mail/set-status', { noticeId, status });
      setNotice(r.notice);
    } catch (e) {
      setError(toInfo(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.show(`${label}를 복사했습니다`); } catch { toast.show('복사하지 못했습니다'); }
  };

  const back = (
    <a href={`#/review/${encodeURIComponent(noticeId)}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft className="size-4" />공고로 돌아가기</a>
  );

  if (notice === undefined) {
    return <div className="space-y-4">{back}{error ? <FsErrorAlert error={error} onRetry={() => void load()} /> : <Loader2 className="size-4 animate-spin text-muted" />}</div>;
  }
  if (notice === null) {
    return <div className="space-y-4">{back}<InlineAlert tone="warn">공고를 찾을 수 없습니다.</InlineAlert></div>;
  }

  const title = notice.basic.title.value ?? notice.id;
  const noticeNo = `${notice.basic.noticeNo.value ?? notice.ref.noticeNo}-${notice.basic.round.value ?? notice.ref.round ?? '000'}`;
  const saved = notice.attachments.filter((a) => a.status === 'saved');
  const missing = notice.attachments.filter((a) => a.status !== 'saved');
  const mailStatus = notice.mail.status;
  const noGroup = rec.data !== null && !groupId;
  const knownCode = error?.code && CODE_MESSAGE[error.code];
  const draftPath = draft ? `${notice.folder.replace(/\/+$/, '')}/mail-draft.json` : null;

  return (
    <div className="space-y-6">
      {back}
      <header className="min-w-0">
        <h1 className="title-mark text-2xl leading-snug font-bold tracking-tight text-balance">{title}</h1>
        <div className="mt-2 pl-[calc(3px+0.75rem)] text-sm text-muted"><span className="font-mono text-sm">{noticeNo}</span></div>
      </header>

      <InlineAlert tone="info">
        {provider === 'gmail'
          ? 'Gmail은 작성 창을 열고 받는 사람, 참조, 제목, 본문(서식 없음)을 채웁니다. 첨부와 서식 본문은 직접 넣어 주세요.'
          : '네이버웍스 자동 작성은 아직 검증 전입니다. 초안은 로컬 파일로 저장되며 메일은 직접 작성해 보내 주세요.'}
      </InlineAlert>
      {knownCode ? <InlineAlert tone="error">{knownCode}</InlineAlert> : <FsErrorAlert error={error} onRetry={() => void load()} />}
      {rec.error && <FsErrorAlert error={rec.error} onRetry={() => void rec.reload()} />}
      {tpls.error && <FsErrorAlert error={tpls.error} onRetry={() => void tpls.reload()} />}
      {noGroup && (
        <InlineAlert tone="warn">
          기본 수신자 그룹이 없습니다. <a href="#/recipients" className="text-accent underline">수신자 화면</a>에서 그룹을 만들고 기본으로 지정하세요.
        </InlineAlert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          {rendered ? <MailPreviewFrame html={rendered.html} subject={rendered.subject} /> : <Loader2 className="size-4 animate-spin text-muted" />}
        </div>

        <div className="space-y-6">
          <Card title="발송 설정">
            <div className="space-y-4">
              <label className="block space-y-1.5 text-sm font-semibold text-ink">
                수신자 그룹
                <Select
                  className="font-normal"
                  value={groupId}
                  placeholder="(선택 없음)"
                  onChange={setGroupSel}
                  options={groups.map((g) => ({ value: g.id, label: g.name, hint: g.isDefault ? '기본' : undefined }))}
                />
              </label>
              <label className="block space-y-1.5 text-sm font-semibold text-ink">
                템플릿
                <Select
                  className="font-normal"
                  value={templateId}
                  onChange={setTplSel}
                  options={templates.map((t) => ({ value: t.id, label: t.name, hint: t.isDefault ? '기본' : undefined }))}
                />
              </label>
            </div>
          </Card>

          <Card title="웹메일로 작성" description={`선택한 그룹과 템플릿으로 ${PROVIDER_LABEL[provider]} 작성 화면을 엽니다.`}>
            <ComposeCard noticeId={noticeId} noticeRef={notice.ref} params={{ ...(groupId ? { groupId } : {}), ...(templateId ? { templateId } : {}) }} jobs={jobs} />
          </Card>

          <Card title="수신자">
            {!resolved ? <p className="text-sm text-muted">그룹을 선택하세요.</p> : (
              <div className="space-y-3 text-sm">
                {(['to', 'cc'] as const).map((role) => (
                  <div key={role} className="flex items-start gap-2">
                    <span className="w-8 shrink-0 pt-1 font-mono text-xs font-semibold text-muted">{role.toUpperCase()}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {resolved.members.filter((m) => m.role === role).map((m) => (
                        <span key={m.id} className="rounded-ctl border border-line bg-sunken px-2 py-1 text-xs" title={m.email}>{m.name || m.email}</span>
                      ))}
                      {resolved.members.every((m) => m.role !== role) && <span className="pt-1 text-xs text-faint">없음</span>}
                    </div>
                  </div>
                ))}
                {resolved.skipped.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <p className="text-xs font-semibold text-muted">제외 {resolved.skipped.length}명</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-muted">
                      {resolved.skipped.map((s, i) => <li key={`${s.id}-${i}`}>{s.name || s.email || s.id} ({SKIP_LABEL[s.reason]})</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="첨부파일">
            <div className="space-y-3 text-sm">
              {saved.length === 0 && missing.length === 0 && <p className="text-muted">첨부파일이 없습니다.</p>}
              {saved.length > 0 && (
                <ul className="space-y-1">
                  {saved.map((a) => <li key={a.id} className="flex items-baseline justify-between gap-3"><span className="break-all">{a.savedName ?? a.originalName}</span><StatusBadge status="ok">첨부됨</StatusBadge></li>)}
                </ul>
              )}
              {missing.length > 0 && (
                <div className="border-t border-line pt-3">
                  <p className="text-xs font-semibold text-danger">미확보 {missing.length}개</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-danger">
                    {missing.map((a) => <li key={a.id} className="break-all">{a.originalName}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          {unresolved.length > 0 && (
            <Card title="확인 필요 변수">
              <ul className="space-y-1.5 text-sm">
                {unresolved.map((u) => (
                  <li key={u.name}>
                    <a href={`#/review/${encodeURIComponent(noticeId)}`} className="text-accent hover:underline">{u.label}</a>
                    <span className="ml-2 text-xs text-muted">{u.status === 'missing' ? '값 없음' : '확인 필요'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="작업">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge status={STATUS_TONE[mailStatus]}>{STATUS_LABEL[mailStatus]}</StatusBadge>
                {mailStatus === 'delivered'
                  ? <Button variant="secondary" loading={statusBusy} disabled={saving} icon={<Undo2 />} onClick={() => void setStatus('none')}>전달 완료 해제</Button>
                  : <Button variant="secondary" loading={statusBusy} disabled={saving} icon={<Check />} onClick={() => void setStatus('delivered')}>전달 완료로 표시</Button>}
              </div>
              <Button loading={saving} disabled={statusBusy || !groupId || !templateId} icon={<Save />} onClick={() => void prepare()}>초안 저장</Button>
              {draftPath && <p className="text-xs break-all text-muted">초안 파일: <span className="font-mono">{draftPath}</span></p>}
              <div className="flex flex-wrap gap-1.5">
                <Button variant="ghost" disabled={!rendered} icon={<ClipboardCopy />} onClick={() => rendered && void copy(rendered.html, 'HTML')}>HTML 복사</Button>
                <Button variant="ghost" disabled={!rendered} icon={<ClipboardCopy />} onClick={() => rendered && void copy(rendered.text, '텍스트')}>텍스트 복사</Button>
                <Button variant="ghost" disabled={!rendered} icon={<ClipboardCopy />} onClick={() => rendered && void copy(rendered.subject, '제목')}>제목 복사</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
      {toast.node}
    </div>
  );
}
