import { Check, Eye, Mail, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IndexEntry } from '../../../core/types/index-file';
import type { SendRecord } from '../../../core/types/compose';
import type { MailDraft } from '../../../core/types/mail';
import type { Notice } from '../../../core/types/notice';
import { kindOf } from '../../../core/model/ids';
import { send } from '../../../messaging/bus';
import { PROVIDER_LABEL } from '../../../core/model/mail-provider';
import { Button, Card, ConfirmDialog, FormActions, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { COLLECT_BADGE, MAIL_STATUS, STEP_LABEL, mailSummary, relatedNotices } from '../../../ui/notice-detail/view';
import { formatDateTime } from '../../../ui/review/format';
import { FsErrorAlert, type FsErrorInfo } from '../FsErrorAlert';
import { noticeHash } from '../route';
import { SentMailModal } from './SentMailModal';

const toInfo = (e: unknown): FsErrorInfo => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

/** 취소 버튼 라벨용 `YYYY-MM-DD HH:mm` */
function labelTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local 입력값(로컬 시각)으로 쓸 현재 시각 */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function HistoryTab({ notice, index, onNoticeChange }: { notice: Notice; index: IndexEntry[]; onNoticeChange?: (n: Notice) => void }) {
  const [records, setRecords] = useState<SendRecord[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [sentAtStr, setSentAtStr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentError, setSentError] = useState<FsErrorInfo | null>(null);
  const [recollecting, setRecollecting] = useState(false);
  const [recollectMsg, setRecollectMsg] = useState<string | null>(null);
  const idRef = useRef(notice.id);
  idRef.current = notice.id;
  const loadRecords = async (isAlive: () => boolean = () => true) => {
    const id = notice.id;
    const ok = () => isAlive() && idRef.current === id;
    try {
      const r = await send('mail/sent-get', { noticeId: id });
      if (ok()) { setRecords(r); setSentError(null); }
    } catch (e) { if (ok()) setSentError(toInfo(e)); }
  };
  useEffect(() => {
    let alive = true;
    setRecords(null);
    setSentError(null);
    // 같은 HistoryTab이 다른 공고로 재사용되므로 이전 공고의 메시지·열린 창을 비운다.
    setRecollectMsg(null);
    setRecollecting(false);
    setVoidTarget(null);
    setViewing(null);
    void loadRecords(() => alive);
    return () => { alive = false; };
  }, [notice.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const addRecord = async () => {
    const id = notice.id;
    setBusy(true);
    setSentError(null);
    try {
      const t = sentAtStr ? new Date(sentAtStr) : new Date();
      const r = await send('mail/sent-add', { noticeId: id, sentAt: Number.isNaN(t.getTime()) ? undefined : t.toISOString(), ...(note.trim() ? { note: note.trim() } : {}) });
      if (idRef.current !== id) return;
      onNoticeChange?.(r.notice);
      void send('deadline/refresh', { reason: 'manual' }).catch(() => undefined);
      setFormOpen(false);
      setNote('');
      await loadRecords();
    } catch (e) { if (idRef.current === id) setSentError(toInfo(e)); } finally { setBusy(false); }
  };
  const [voidTarget, setVoidTarget] = useState<SendRecord | null>(null);
  const closeVoid = useCallback(() => setVoidTarget(null), []);
  const voidRecord = async (recordId: string) => {
    setVoidTarget(null);
    const id = notice.id;
    setBusy(true);
    setSentError(null);
    try {
      const r = await send('mail/sent-void', { noticeId: id, recordId });
      if (idRef.current !== id) return;
      onNoticeChange?.(r.notice);
      await loadRecords();
    } catch (e) { if (idRef.current === id) setSentError(toInfo(e)); } finally { setBusy(false); }
  };
  const [viewing, setViewing] = useState<SendRecord | null>(null);
  const closeViewing = useCallback(() => setViewing(null), []);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  useEffect(() => {
    let alive = true;
    send('mail/draft-get', { noticeId: notice.id }).then((d) => { if (alive) setDraft(d); }, () => { if (alive) setDraft(null); });
    return () => { alive = false; };
  }, [notice.id, notice.mail.status]);

  const recollect = async () => {
    const id = notice.id;
    setRecollecting(true);
    setRecollectMsg(null);
    try {
      const r = await send('job/start', { type: 'collect', ref: notice.ref });
      if (idRef.current === id) setRecollectMsg(r.code === 'JOB_ALREADY_RUNNING' ? '이미 수집이 진행 중입니다' : '다시 수집을 시작했습니다');
    } catch (e) {
      if (idRef.current === id) setRecollectMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (idRef.current === id) setRecollecting(false);
    }
  };

  const errors = notice.collect.errors;
  const related = relatedNotices(notice, index);
  const mail = mailSummary(notice, draft);
  const ms = MAIL_STATUS[mail.status];
  const th = 'px-6 py-3 font-medium';
  const liveRecords = (records ?? []).filter((r) => !r.voidedAt);
  const latestSent = liveRecords.reduce<SendRecord | null>((m, r) => (!m || Date.parse(r.sentAt) > Date.parse(m.sentAt) ? r : m), null);
  const otherRounds = related.rounds.some((r) => !r.current);

  const savedFiles = notice.attachments.filter((a) => a.status === 'saved').length;
  const totalFiles = notice.attachments.length;
  const collectWarn = errors.length > 0 || savedFiles < totalFiles;
  const steps: ProgressStep[] = [
    {
      label: '수집',
      state: notice.collect.status === 'collected' ? 'done' : notice.collect.status === 'partial' ? 'warn' : 'error',
      when: formatDateTime(notice.collect.collectedAt),
      sub: `${totalFiles === 0 ? '첨부 없음' : `첨부 ${savedFiles === totalFiles ? totalFiles : `${savedFiles}/${totalFiles}`}개`} · ${errors.length > 0 ? `오류 ${errors.length}건` : '오류 없음'}`,
      subWarn: collectWarn,
    },
    mail.lastComposedAt
      ? { label: '메일 작성', state: 'done', when: formatDateTime(mail.lastComposedAt) }
      : { label: '메일 작성', state: 'todo', when: '아직 작성하지 않음' },
    mail.draft
      ? { label: '발송 준비', state: 'done', when: formatDateTime(mail.draft.preparedAt), sub: mail.draft.editedAt ? `편집 ${formatDateTime(mail.draft.editedAt)}` : '편집 없음' }
      : { label: '발송 준비', state: 'todo', when: '—' },
    latestSent
      ? {
          label: '발송', state: 'done', when: formatDateTime(latestSent.sentAt),
          sub: [latestSent.provider ? PROVIDER_LABEL[latestSent.provider] : '', latestSent.source === 'auto' ? (latestSent.signal?.kind === 'auto' ? '자동 발송' : '자동 기록') : '직접 기록', liveRecords.length > 1 ? `총 ${liveRecords.length}회` : ''].filter(Boolean).join(' · '),
        }
      : mail.deliveredAt
        ? { label: '발송', state: 'done', when: formatDateTime(mail.deliveredAt) }
        : { label: '발송', state: 'todo', when: mail.draft ? '아직 보내지 않음' : '—' },
  ];

  const goCompose = () => { window.location.hash = `#/mail/${encodeURIComponent(notice.id)}`; };
  const mailHint = latestSent ? `마지막 발송 ${formatDateTime(latestSent.sentAt)}` : mail.draft ? '초안을 확인하고 웹메일에서 보내세요' : undefined;

  return (
    <div className="space-y-6">
      <SentMailModal noticeId={notice.id} record={viewing} onClose={closeViewing} />

      <section className="rounded-card border border-line bg-surface shadow-card" aria-label="진행 단계">
        <ProgressSteps steps={steps} />
      </section>

      <Card title="메일" action={<StatusBadge status={ms.tone}>{ms.label}</StatusBadge>}>
        {mail.draft ? (
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted">제목</dt><dd>{mail.draft.subject || '(제목 없음)'}</dd>
            <dt className="text-muted">받는 사람</dt><dd>{mail.draft.to}명 · {mail.draft.cc > 0 ? `참조 ${mail.draft.cc}명` : '참조 없음'}</dd>
            <dt className="text-muted">첨부</dt><dd>{mail.draft.attachments}개{mail.draft.skipped > 0 ? ` · 제외 ${mail.draft.skipped}개` : ''}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted">아직 메일 초안이 없습니다</p>
        )}
        <div className="border-t border-line pt-4">
          <FormActions status={mailHint && <span className="text-sm text-faint">{mailHint}</span>}>
            {latestSent ? (
              <>
                <Button variant="secondary" icon={<Mail />} onClick={goCompose}>메일 다시 작성</Button>
                <Button icon={<Eye />} onClick={() => setViewing(latestSent)}>보낸 메일 보기</Button>
              </>
            ) : (
              <Button icon={<Mail />} onClick={goCompose}>{notice.mail.status !== 'none' ? '메일 초안 보기' : '메일 작성 준비'}</Button>
            )}
          </FormActions>
        </div>
      </Card>

      <Card title={liveRecords.length > 0 ? `발송 이력 (${liveRecords.length})` : '발송 이력'}>
        <div className="-mx-6 -my-5">
          {sentError && <div className="px-6 pt-4"><FsErrorAlert error={sentError} onRetry={() => void loadRecords()} /></div>}
          {records === null ? null : records.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted">아직 기록된 발송이 없습니다. 웹메일에서 보내면 자동으로 기록됩니다.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {records.slice().sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((r) => {
                const voided = !!r.voidedAt;
                const text = [r.summary.subject, r.note].filter(Boolean).join(' · ');
                return (
                  <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3">
                    <span className={`font-mono text-[13px] whitespace-nowrap tabular-nums ${voided ? 'text-faint line-through' : 'text-muted'}`}>{formatDateTime(r.sentAt)}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <Chip accent={r.source === 'auto'}>{r.source === 'auto' ? (r.signal?.kind === 'auto' ? '자동 발송' : '자동') : '직접'}</Chip>
                      {r.provider && <span className="text-[13px] whitespace-nowrap text-muted">{PROVIDER_LABEL[r.provider]}</span>}
                      <span className={`min-w-0 truncate ${voided ? 'text-faint line-through' : ''}`}>{text || '—'}</span>
                      {r.source === 'auto' && !r.signal?.confirmed && <StatusBadge status="warn">완료 확인 없음</StatusBadge>}
                      {voided && <Chip>취소됨</Chip>}
                    </span>
                    <span className="flex gap-0.5">
                      <Button variant="ghost" className="!h-8 !px-2.5 !text-[13px]" icon={<Eye />} aria-label={`${labelTime(r.sentAt)} 보낸 메일 보기`} onClick={() => setViewing(r)}>내용</Button>
                      {!voided && <Button variant="ghost" className="!h-8 !px-2.5 !text-[13px] hover:!text-danger" disabled={busy} aria-label={`${labelTime(r.sentAt)} 발송 기록 취소`} onClick={() => setVoidTarget(r)}>취소</Button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {formOpen ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-line bg-sunken px-6 py-4">
              <label className="space-y-1.5 text-sm font-semibold">
                <span className="block">발송 시각</span>
                <input type="datetime-local" className={`${inputClass} !w-60`} value={sentAtStr} onChange={(e) => setSentAtStr(e.target.value)} />
              </label>
              <label className="min-w-60 flex-1 space-y-1.5 text-sm font-semibold">
                <span className="block">메모 (선택)</span>
                <input className={inputClass} maxLength={200} placeholder="예: 네이버웍스에서 직접 발송" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>닫기</Button>
                <Button icon={<Check />} loading={busy} onClick={() => void addRecord()}>기록</Button>
              </div>
            </div>
          ) : (
            <p className="border-t border-line px-6 py-3 text-[13px] text-faint">
              웹메일 발송이 자동으로 기록되지 않았나요?{' '}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setSentAtStr(nowLocal()); setFormOpen(true); }}>직접 기록</button>
            </p>
          )}
        </div>
      </Card>

      {(errors.length > 0 || notice.collect.status !== 'collected') && (
        <Card title={errors.length > 0 ? `수집 오류 (${errors.length})` : '수집 오류'} action={<StatusBadge status={COLLECT_BADGE[notice.collect.status].tone}>{COLLECT_BADGE[notice.collect.status].text}</StatusBadge>}>
          {errors.length === 0 ? <p className="text-sm text-muted">기록된 오류 내용이 없습니다. 다시 수집해 보세요.</p> : (
          <div className="-mx-6 -mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-sunken text-muted"><tr>{['단계', '내용', '다시 시도'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-6 py-3 whitespace-nowrap">{e.step ? STEP_LABEL[e.step] ?? e.step : '—'}</td>
                    <td className="px-6 py-3">{e.message} <span className="ml-1 font-mono text-xs text-muted">{e.code}</span></td>
                    <td className="px-6 py-3 whitespace-nowrap">{e.retryable ? '가능' : '불가'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className="border-t border-line pt-4">
            <FormActions status={recollectMsg && <span className="text-sm text-muted">{recollectMsg}</span>}>
              <Button variant="secondary" icon={<RotateCcw />} loading={recollecting} onClick={() => void recollect()}>다시 수집</Button>
            </FormActions>
          </div>
        </Card>
      )}

      {kindOf(notice.ref) !== 'prespec' && (otherRounds || notice.isCorrection) && (
        <Card title="같은 공고의 다른 차수" action={notice.isCorrection ? <StatusBadge status="warn">정정공고</StatusBadge> : undefined}>
          {otherRounds ? (
            <ul className="-mx-6 -my-5 divide-y divide-line text-sm">
              {related.rounds.map((r) => (
                <li key={r.noticeId} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3">
                  <span className={`font-mono ${r.current ? 'text-ink' : 'text-muted'}`}>{r.round}</span>
                  {r.current
                    ? <span className="flex min-w-0 items-center gap-2 font-semibold"><span className="truncate">{r.title}</span><Chip>지금 보는 공고</Chip></span>
                    : <a href={noticeHash(r.noticeId)} className="truncate text-accent hover:underline">{r.title}</a>}
                  <span className="font-mono text-[13px] whitespace-nowrap text-muted tabular-nums">{formatDateTime(r.collectedAt)} 수집</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">정정공고입니다. 같은 공고번호의 이전 차수는 수집되지 않았습니다.</p>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={voidTarget !== null}
        title="발송 기록을 취소할까요?"
        description={voidTarget && `${labelTime(voidTarget.sentAt)}에 기록된 발송을 취소합니다. 기록은 '취소됨'으로 남습니다.`}
        confirmLabel="기록 취소"
        cancelLabel="닫기"
        onConfirm={() => { if (voidTarget) void voidRecord(voidTarget.id); }}
        onCancel={closeVoid}
      />
    </div>
  );
}

type StepState = 'done' | 'warn' | 'error' | 'todo';
interface ProgressStep { label: string; state: StepState; when: string; sub?: string; subWarn?: boolean }

const STEP_DOT: Record<StepState, string> = {
  done: 'border-ok bg-ok text-surface',
  warn: 'border-warn bg-warn text-surface',
  error: 'border-danger bg-danger text-surface',
  todo: 'border-line-strong bg-surface',
};

/** 수집 → 메일 작성 → 발송 준비 → 발송 진행 단계. 좁으면 세로로 쌓는다. */
function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="grid gap-4 px-6 py-5 sm:grid-cols-4 sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.label} className="relative min-w-0 sm:pr-3">
          {i < steps.length - 1 && <span aria-hidden className={`absolute top-[10px] right-0 left-[22px] hidden h-0.5 sm:block ${s.state === 'todo' ? 'bg-line-strong' : 'bg-ok/50'}`} />}
          <span className={`relative grid size-[22px] place-items-center rounded-full border-2 ${STEP_DOT[s.state]}`}>
            {s.state === 'done' && <Check className="size-3" strokeWidth={3} />}
            {s.state === 'warn' && <span className="text-xs leading-none font-bold">!</span>}
            {s.state === 'error' && <X className="size-3" strokeWidth={3} />}
          </span>
          <div className="mt-2.5 text-sm font-semibold text-ink">{s.label}</div>
          <div className="text-[13px] text-muted">{s.when}</div>
          {s.sub && <div className={`mt-0.5 text-xs ${s.subWarn ? 'text-warn' : 'text-faint'}`}>{s.sub}</div>}
        </li>
      ))}
    </ol>
  );
}

function Chip({ accent, children }: { accent?: boolean; children: ReactNode }) {
  return <span className={`shrink-0 rounded-full border border-line bg-sunken px-[7px] py-px text-xs font-semibold whitespace-nowrap ${accent ? 'text-accent' : 'text-muted'}`}>{children}</span>;
}
