import { FileText, LayoutDashboard, ListChecks, Settings as SettingsIcon, Stethoscope, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { send } from '../../messaging/bus';
import type { FsStatus } from '../../messaging/protocol';
import { parseHandoffReasons } from '../../core/model/handoff';
import { Logo, StatusBadge } from '../../ui/components';
import { GrantPage } from './GrantPage';
import { DiagnosticsPage } from './DiagnosticsPage';
import { HomePage } from './HomePage';
import { MailPreparePage } from './MailPreparePage';
import { NoticesPage } from './NoticesPage';
import { RecipientsPage } from './RecipientsPage';
import { ReviewPage } from './ReviewPage';
import { SettingsPage } from './SettingsPage';
import { TemplateEditor } from './TemplateEditor';
import { TemplatesPage } from './TemplatesPage';
import { parseRoute, type Page } from './route';

const MENU: Array<{ id: Page; label: string; Icon: typeof SettingsIcon }> = [
  { id: 'home', label: '홈', Icon: LayoutDashboard },
  { id: 'notices', label: '공고', Icon: ListChecks },
  { id: 'recipients', label: '수신자', Icon: Users },
  { id: 'templates', label: '템플릿', Icon: FileText },
  { id: 'settings', label: '설정', Icon: SettingsIcon },
  { id: 'diagnostics', label: '진단', Icon: Stethoscope },
];

const FOLDER_BADGE = {
  granted: { tone: 'ok', text: '저장 폴더 연결됨' },
  prompt: { tone: 'warn', text: '폴더 재승인 필요' },
  denied: { tone: 'error', text: '폴더 접근 거부됨' },
} as const;

/** 사이드바 아래 저장 폴더 상태. 화면 이동과 창 포커스 때 다시 읽는다. 조회 실패 시 숨긴다. */
function FolderStatus({ refreshKey }: { refreshKey: string }) {
  const [status, setStatus] = useState<FsStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void send('fs/status', undefined, { timeoutMs: 30_000 }).then((s) => { if (alive) setStatus(s); }, () => { if (alive) setStatus(null); });
    load();
    window.addEventListener('focus', load);
    return () => { alive = false; window.removeEventListener('focus', load); };
  }, [refreshKey]);
  if (!status) return null;
  const b = status.hasRoot ? FOLDER_BADGE[status.permission] : { tone: 'idle', text: '저장 폴더 미설정' } as const;
  return (
    <a href="#/settings" className="mt-auto block space-y-0.5 border-t border-line px-3 pt-4">
      <StatusBadge status={b.tone}>{b.text}</StatusBadge>
      {status.hasRoot && <span className="block truncate text-sm text-muted">{status.rootName}</span>}
    </a>
  );
}

export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const route = parseRoute(hash);
  if (route.page === 'grant') return <GrantPage />;
  const active: Page = route.page === 'review' || route.page === 'mail' ? 'notices' : route.page === 'template' ? 'templates' : route.page;
  const wide = route.page !== 'settings' && route.page !== 'diagnostics';

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-6">
        <div className="flex items-center gap-2.5 px-3">
          <Logo size={30} />
          <div className="text-lg leading-tight font-bold tracking-tight">나의 입찰메이트</div>
        </div>
        <nav className="grid gap-1">
          {MENU.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              aria-current={active === id ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-ctl px-3 py-2.5 text-lg transition-colors motion-reduce:transition-none ${
                active === id ? 'bg-select font-semibold text-ink' : 'font-medium text-muted hover:bg-sunken hover:text-ink'
              }`}
            >
              <Icon className="size-5" />
              {label}
            </a>
          ))}
        </nav>
        <FolderStatus refreshKey={hash} />
      </aside>
      <main className="min-w-0 flex-1 px-12 pt-10 pb-16">
        <div className={`mx-auto space-y-6 ${route.page === 'template' ? 'max-w-[1440px]' : wide ? 'max-w-[1120px]' : 'max-w-[800px]'}`}>
          {route.page === 'home' && <HomePage />}
          {route.page === 'notices' && <NoticesPage />}
          {route.page === 'recipients' && <RecipientsPage />}
          {route.page === 'templates' && <TemplatesPage />}
          {route.page === 'template' && <TemplateEditor key={route.id} id={route.id} />}
          {route.page === 'mail' && <MailPreparePage key={route.noticeId} noticeId={route.noticeId} />}
          {route.page === 'review' && <ReviewPage key={route.noticeId} noticeId={route.noticeId} handoff={parseHandoffReasons(route.query.handoff)} />}
          {route.page === 'settings' && <SettingsPage />}
          {route.page === 'diagnostics' && <DiagnosticsPage />}
        </div>
      </main>
    </div>
  );
}
