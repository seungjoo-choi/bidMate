import { ClipboardCopy } from 'lucide-react';
import type { Notice } from '../../../core/types/notice';
import { Button, EmptyState, StatusBadge } from '../../../ui/components';
import { ATTACHMENT_STATUS, attachmentRows, attachmentSummary, folderRelPath } from '../../../ui/notice-detail/view';
import { StatStrip } from './parts';

export function FilesTab({ notice, toast }: { notice: Notice; toast: { show: (t: string) => void } }) {
  const rows = attachmentRows(notice);
  if (rows.length === 0) return <EmptyState title="첨부파일이 없습니다" />;
  const sum = attachmentSummary(notice);
  const dir = `${folderRelPath(notice.folder)}/attachments`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(dir); toast.show('복사됨'); } catch { toast.show('복사하지 못했습니다'); }
  };
  return (
    <div className="space-y-6">
      <StatStrip items={[
        { label: '전체', value: String(sum.total) },
        { label: '저장', value: String(sum.saved) },
        { label: '실패', value: String(sum.failed), ...(sum.failed > 0 ? { tone: 'danger' as const } : {}) },
        { label: '건너뜀', value: String(sum.skipped), ...(sum.skipped === 0 ? { tone: 'muted' as const } : {}) },
      ]} />
      <div className="flex items-center justify-between gap-4 rounded-card bg-sunken px-5 py-3 text-sm">
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-muted">저장 폴더</span>
          <span className="truncate font-mono">{dir}</span>
        </span>
        <Button variant="ghost" icon={<ClipboardCopy />} onClick={() => void copy()}>경로 복사</Button>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-sunken text-muted">
            <tr>{['번호', '파일명', '종류', '크기', '상태', '시도', '비고', '동작'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = ATTACHMENT_STATUS[r.status];
              return (
                <tr key={r.id} className="border-t border-line" title={r.openable ? undefined : '브라우저에서 열 수 없는 형식입니다. 폴더 경로를 복사해 탐색기에서 여세요'}>
                  <td className="px-5 py-3 font-mono tabular-nums">{r.no}</td>
                  <td className="max-w-xs px-5 py-3 break-all">
                    {r.name}
                    {r.savedName && <div className="text-xs text-faint">{r.savedName}</div>}
                  </td>
                  <td className="px-5 py-3">{r.kind}</td>
                  <td className="px-5 py-3 whitespace-nowrap tabular-nums">{r.size}</td>
                  <td className="px-5 py-3"><StatusBadge status={st.tone}>{st.label}</StatusBadge></td>
                  <td className="px-5 py-3 tabular-nums">{r.attempts}</td>
                  <td className="max-w-xs px-5 py-3 break-words text-muted">{r.remark}</td>
                  <td className="px-5 py-3">{/* 열기 버튼 자리(S3) */}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
