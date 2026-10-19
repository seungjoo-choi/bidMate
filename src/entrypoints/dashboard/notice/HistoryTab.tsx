import { Check, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IndexEntry } from '../../../core/types/index-file';
import type { SendRecord } from '../../../core/types/compose';
import type { Job } from '../../../core/types/job';
import type { MailDraft } from '../../../core/types/mail';
import type { Notice } from '../../../core/types/notice';
import { kindOf } from '../../../core/model/ids';
import { send } from '../../../messaging/bus';
import { PROVIDER_LABEL } from '../../../core/model/mail-provider';
import { Button, Card, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { type DetailRow, COLLECT_BADGE, MAIL_STATUS, STEP_LABEL, mailSummary, relatedNotices, sessionJobRows } from '../../../ui/notice-detail/view';
import { formatDateTime } from '../../../ui/review/format';
import { FsErrorAlert, type FsErrorInfo } from '../FsErrorAlert';
import { noticeHash } from '../route';
import { DetailList } from './parts';

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

export function HistoryTab({ notice, index, jobs, onNoticeChange }: { notice: Notice; index: IndexEntry[]; jobs: Job[]; onNoticeChange?: (n: Notice) => void }) {
  const [records, setRecords] = useState<SendRecord[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [sentAtStr, setSentAtStr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentError, setSentError] = useState<FsErrorInfo | null>(null);
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
      setFormOpen(false);
      setNote('');
      await loadRecords();
    } catch (e) { if (idRef.current === id) setSentError(toInfo(e)); } finally { setBusy(false); }
  };
  const voidRecord = async (recordId: string) => {
    if (!window.confirm('이 발송 기록을 취소할까요?')) return;
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
  const [draft, setDraft] = useState<MailDraft | null>(null);
  useEffect(() => {
    let alive = true;
    send('mail/draft-get', { noticeId: notice.id }).then((d) => { if (alive) setDraft(d); }, () => { if (alive) setDraft(null); });
    return () => { alive = false; };
  }, [notice.id, notice.mail.status]);

  const cb = COLLECT_BADGE[notice.collect.status];
  const errors = notice.collect.errors;
  const related = relatedNotices(notice, index);
  const mail = mailSummary(notice, draft);
  const ms = MAIL_STATUS[mail.status];
  const sessionRows = sessionJobRows(jobs, notice.id);
  const th = 'px-6 py-3 font-medium';

  const collectRows: DetailRow[] = [
    { label: '수집 시각', value: formatDateTime(notice.collect.collectedAt) },
    { label: '오류', value: errors.length === 0 ? '없음' : `${errors.length}건` },
    { label: '마지막 작업', value: notice.collect.lastJobId || '—' },
  ];
  const mailRows: DetailRow[] = [
    { label: '마지막 작성', value: mail.lastComposedAt ? formatDateTime(mail.lastComposedAt) : '—' },
    { label: '발송 완료', value: mail.deliveredAt ? formatDateTime(mail.deliveredAt) : '—' },
    ...(mail.draft ? [
      { label: '초안 제목', value: mail.draft.subject || '—' },
      { label: '받는 사람', value: `${mail.draft.to}명, 참조 ${mail.draft.cc}명` },
      { label: '첨부', value: `${mail.draft.attachments}개${mail.draft.skipped > 0 ? `, 제외/건너뜀 ${mail.draft.skipped}개` : ''}` },
      { label: '준비/편집', value: `${formatDateTime(mail.draft.preparedAt)} / ${mail.draft.editedAt ? formatDateTime(mail.draft.editedAt) : '편집 없음'}` },
    ] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="수집" action={<StatusBadge status={cb.tone}>{cb.text}</StatusBadge>}>
          <DetailList rows={collectRows} />
        </Card>
        <Card
          title="메일"
          action={<StatusBadge status={ms.tone}>{ms.label}</StatusBadge>}
        >
          <DetailList rows={mailRows} />
          <div className="border-t border-line pt-4">
            <Button variant="secondary" icon={<Mail />} onClick={() => { window.location.hash = `#/mail/${encodeURIComponent(notice.id)}`; }}>
              {notice.mail.status !== 'none' ? '메일 초안 보기' : '메일 작성 준비'}
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title={records ? `발송 이력 (${records.filter((r) => !r.voidedAt).length})` : '발송 이력'}
        action={!formOpen ? <Button variant="secondary" icon={<Check />} onClick={() => { setSentAtStr(nowLocal()); setFormOpen(true); }}>{(records ?? []).some((r) => !r.voidedAt) ? '발송 1회 더 기록' : '발송 완료로 기록'}</Button> : undefined}
      >
        {sentError && <div className="mb-3"><FsErrorAlert error={sentError} onRetry={() => void loadRecords()} /></div>}
        {formOpen && (
          <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-line pb-4">
            <label className="space-y-1.5 text-sm font-semibold">
              <span className="block">발송 시각</span>
              <input type="datetime-local" className={`${inputClass} !w-60`} value={sentAtStr} onChange={(e) => setSentAtStr(e.target.value)} />
            </label>
            <label className="min-w-60 flex-1 space-y-1.5 text-sm font-semibold">
              <span className="block">메모 (선택)</span>
              <input className={inputClass} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button loading={busy} onClick={() => void addRecord()}>기록</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>닫기</Button>
          </div>
        )}
        {records === null ? null : records.length === 0 ? (
          <p className="text-sm text-muted">기록된 발송이 없습니다</p>
        ) : (
          <ul className="-my-2.5 divide-y divide-line text-sm">
            {(records ?? []).slice().sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((r) => {
              const voided = !!r.voidedAt;
              return (
                <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 py-2.5">
                  <span className={`font-mono whitespace-nowrap tabular-nums ${voided ? 'text-faint line-through' : ''}`}>{formatDateTime(r.sentAt)}</span>
                  <span className={`min-w-0 truncate ${voided ? 'text-faint line-through' : ''}`}>
                    {r.source === 'auto' ? '자동' : '수동'}
                    {r.provider ? `, ${PROVIDER_LABEL[r.provider]}` : ''}
                    {r.summary.subject ? `, ${r.summary.subject}` : ''}
                    {r.note ? `, ${r.note}` : ''}
                    {r.source === 'auto' && !r.signal?.confirmed && <span className="ml-2 align-middle"><StatusBadge status="warn">완료 확인 없음</StatusBadge></span>}
                    {voided && <span className="ml-2 align-middle"><StatusBadge status="idle">취소됨</StatusBadge></span>}
                  </span>
                  {!voided && <Button variant="ghost" disabled={busy} aria-label={`${labelTime(r.sentAt)} 발송 기록 취소`} onClick={() => void voidRecord(r.id)}>취소</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {errors.length > 0 && (
        <Card title={`수집 오류 (${errors.length})`}>
          <div className="-mx-6 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-sunken text-muted"><tr>{['단계', '코드', '메시지', '재시도 가능'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-6 py-3 whitespace-nowrap">{e.step ? STEP_LABEL[e.step] ?? e.step : '—'}</td>
                    <td className="px-6 py-3 font-mono text-xs">{e.code}</td>
                    <td className="px-6 py-3 break-words">{e.message}</td>
                    <td className="px-6 py-3">{e.retryable ? '예' : '아니오'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {kindOf(notice.ref) !== 'prespec' && (
        <Card
          title="정정공고 연결"
          action={notice.isCorrection ? <StatusBadge status="warn">정정공고</StatusBadge> : undefined}
        >
          {!related.rounds.some((r) => !r.current) && !related.supersededBy ? (
            <p className="text-sm text-muted">같은 공고번호의 다른 차수는 수집되지 않았습니다</p>
          ) : (
            <ul className="-my-2.5 divide-y divide-line text-sm">
              {related.rounds.map((r) => (
                <li key={r.noticeId} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-4 py-2.5">
                  <span className="font-mono text-muted">{r.round}</span>
                  {r.current
                    ? <span className="truncate font-medium">{r.title} <span className="ml-1.5 align-middle"><StatusBadge status="idle">현재</StatusBadge></span></span>
                    : <a href={noticeHash(r.noticeId)} className="truncate text-accent hover:underline">{r.title}</a>}
                  <span className="font-mono text-muted tabular-nums">{formatDateTime(r.collectedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {related.supersededBy && (
            <p className="text-sm">이 공고를 대체한 공고: <a href={noticeHash(related.supersededBy)} className="text-accent hover:underline">{related.supersededBy}</a></p>
          )}
        </Card>
      )}

      <Card title="이번 세션 작업" description="브라우저를 다시 시작하면 사라지는 기록입니다">
        {sessionRows.length === 0 ? (
          <p className="text-sm text-muted">이번 세션에 이 공고로 실행한 작업이 없습니다</p>
        ) : (
          <div className="-mx-6 -my-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-sunken text-muted"><tr>{['종류', '상태', '시작', '종료', '오류', '후속'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {sessionRows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-6 py-3">{r.type}</td>
                    <td className="px-6 py-3">{r.status}</td>
                    <td className="px-6 py-3 font-mono tabular-nums">{r.startedAt}</td>
                    <td className="px-6 py-3 font-mono tabular-nums">{r.endedAt}</td>
                    <td className="px-6 py-3 break-words">{r.errorCount > 0 ? `${r.errorCount}건 ${r.firstError}` : '—'}</td>
                    <td className="px-6 py-3">{r.handoff || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
