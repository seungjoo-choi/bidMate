import { AlertTriangle, File, FileArchive, FileSpreadsheet, FileText, Paperclip } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SendRecord, SentMailView } from '../../../core/types/compose';
import { send } from '../../../messaging/bus';
import { useRecipients } from '../../../ui/hooks/useConfig';
import { formatBytes } from '../../../ui/notice-detail/view';
import { formatDateTime } from '../../../ui/review/format';
import { FsErrorAlert, type FsErrorInfo } from '../FsErrorAlert';
import { Modal } from '../recipients/shared';
import { MailPreviewFrame } from '../templates/MailPreviewFrame';

const extOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function FileIcon({ name }: { name: string }) {
  const ext = extOf(name);
  const cls = 'size-5 shrink-0';
  if (['zip', '7z', 'rar', 'egg'].includes(ext)) return <FileArchive className={`${cls} text-warn`} />;
  if (['xls', 'xlsx', 'xlsm', 'csv', 'cell'].includes(ext)) return <FileSpreadsheet className={`${cls} text-ok`} />;
  if (['pdf', 'hwp', 'hwpx', 'doc', 'docx', 'txt'].includes(ext)) return <FileText className={`${cls} text-accent`} />;
  return <File className={`${cls} text-faint`} />;
}

/** 수신자 목록에 있는 주소는 이름으로, 없으면 주소 그대로 보여 준다. 주소는 툴팁으로 남긴다. */
function Recipients({ label, list, names }: { label: string; list: string[]; names: Map<string, string> }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-1 text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {list.length === 0
          ? <span className="pt-0.5 text-sm text-faint">없음</span>
          : list.map((a) => (
            <span key={a} title={a} className="rounded-full bg-sunken px-2.5 py-0.5 text-sm text-ink wrap-anywhere">
              {names.get(a.trim().toLowerCase()) || a}
            </span>
          ))}
      </div>
    </div>
  );
}

/** 발송 기록 하나의 메일 내용(받는 사람·제목·본문·첨부)을 읽기 전용으로 보여 준다. */
export function SentMailModal({ noticeId, record, onClose }: { noticeId: string; record: SendRecord | null; onClose: () => void }) {
  const [view, setView] = useState<SentMailView | null | undefined>(undefined);
  const [error, setError] = useState<FsErrorInfo | null>(null);
  const { data: recipientsData } = useRecipients();
  const names = useMemo(
    () => new Map((recipientsData?.recipients ?? []).filter((r) => r.name.trim()).map((r) => [r.email.trim().toLowerCase(), r.name.trim()])),
    [recipientsData],
  );
  const recordId = record?.id;
  useEffect(() => {
    if (!recordId) return;
    let alive = true;
    setView(undefined);
    setError(null);
    send('mail/sent-view', { noticeId, recordId }).then(
      (v) => { if (alive) setView(v); },
      (e: unknown) => { if (alive) setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { alive = false; };
  }, [noticeId, recordId]);

  const files = view ? [...view.attachments].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })) : [];
  const total = files.reduce((s, f) => s + (f.size ?? 0), 0);

  return (
    <Modal open={!!record} size="xl" title="보낸 메일" onClose={onClose}>
      {error && <FsErrorAlert error={error} />}
      {view === null && <p className="py-6 text-center text-sm text-muted">이 발송에 연결된 메일 내용이 없습니다</p>}
      {view && (
        <div className="space-y-5">
          {view.source === 'draft' && (
            <div className="flex items-start gap-2 rounded-ctl border border-line bg-sunken px-3 py-2.5 text-sm text-muted">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>이 발송에 연결된 작성 기록이 없어 현재 저장된 초안을 보여 줍니다. 실제 보낸 내용과 다를 수 있습니다.</span>
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-lg font-semibold leading-snug text-ink break-keep">{view.subject || '(제목 없음)'}</h3>
            <p className="text-xs text-muted tabular-nums">
              {record && <>발송 {formatDateTime(record.sentAt)}</>}
              {view.composedAt && <span className="ml-3">작성 {formatDateTime(view.composedAt)}</span>}
            </p>
            <div className="space-y-2 border-t border-line pt-3">
              <Recipients label="받는 사람" list={view.to} names={names} />
              {view.cc.length > 0 && <Recipients label="참조" list={view.cc} names={names} />}
            </div>
          </section>

          <MailPreviewFrame html={view.html} height={440} fill />

          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Paperclip className="size-4 text-muted" />
              첨부 {files.length}개
              {total > 0 && <span className="font-normal text-muted">· {formatBytes(total)}</span>}
            </h4>
            {files.length === 0 ? (
              <p className="text-sm text-faint">첨부 파일이 없습니다</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 rounded-ctl border border-line bg-surface px-3 py-2">
                    <FileIcon name={f.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink" title={f.name}>{f.name}</span>
                      <span className="block text-xs text-muted">
                        {extOf(f.name).toUpperCase()}{f.size ? ` · ${formatBytes(f.size)}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.source === 'compose' && <p className="text-xs text-faint">bidMate가 웹메일에 채워 넣은 내용입니다. 웹메일에서 보내기 전에 직접 고친 부분은 반영되지 않습니다.</p>}
        </div>
      )}
    </Modal>
  );
}
