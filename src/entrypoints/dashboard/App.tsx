import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { send } from '../../messaging/bus';
import type { FsStatus } from '../../messaging/protocol';
import { parseHandoffReasons } from '../../core/model/handoff';
import { ErrorBoundary, Logo, StatusBadge } from '../../ui/components';
import { EvalAutoDock } from './evaluations/EvalAutoDock';
import { EvaluationDetailPage } from './evaluations/EvaluationDetailPage';
import { EvaluationsPage } from './evaluations/EvaluationsPage';
import { GrantPage } from './GrantPage';
import { HomePage } from './HomePage';
import { MailPreparePage } from './MailPreparePage';
import { CompareResultPage } from './rfp/CompareResultPage';
import { RfpPage } from './rfp/RfpPage';
import { NoticeDetailPage } from './notice/NoticeDetailPage';
import { NoticesPage } from './NoticesPage';
import { RecipientsPage } from './RecipientsPage';
import { MailsPage } from './MailsPage';
import { SettingsPage } from './SettingsPage';
import { StatsPage } from './stats/StatsPage';
import { TemplateEditor } from './TemplateEditor';
import { TemplatesPage } from './TemplatesPage';
import { MENU } from './menu';
import { parseRoute, settingsSectionOf, type Page } from './route';

const FOLDER_BADGE = {
  granted: { tone: 'ok', text: '연결됨' },
  prompt: { tone: 'warn', text: '재승인 필요' },
  denied: { tone: 'error', text: '접근 거부됨' },
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
  const b = status.hasRoot ? FOLDER_BADGE[status.permission] : { tone: 'idle', text: '미설정' } as const;
  return (
    <a href="#/settings?section=storage" title="저장 폴더 설정으로 이동" className="mt-auto block space-y-1.5 border-t border-line px-3 pt-4">
      <span className="block text-xs font-medium text-muted">저장 폴더</span>
      {status.hasRoot && (
        <span className="flex items-center gap-1.5 text-sm text-ink">
          <FolderOpen className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate">{status.rootName}</span>
        </span>
      )}
      <StatusBadge status={b.tone}>{b.text}</StatusBadge>
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
  const active: Page = route.page === 'mail' && route.query.from === 'mails' ? 'mails' : route.page === 'notice' || route.page === 'mail' ? 'notices' : route.page === 'template' ? 'templates' : route.page === 'evaluation' ? 'evaluations' : route.page === 'rfp-compare' ? 'rfp' : route.page;

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-6">
        <a href="#/home" className="flex items-center gap-2.5 px-3" aria-label="홈으로">
          <Logo size={30} />
          <div>
            <div className="text-lg leading-tight font-bold tracking-tight">BidMate</div>
            <div className="text-xs leading-tight text-muted">비드메이트</div>
          </div>
        </a>
        <nav className="grid gap-1">
          {MENU.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              aria-current={active === id ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-ctl px-3 py-2.5 text-base transition-colors motion-reduce:transition-none ${
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
        <div className={`mx-auto space-y-6 ${route.page === 'template' || route.page === 'recipients' || route.page === 'notices' ? 'max-w-[90rem]' : route.page === 'evaluation' ? 'max-w-[105rem]' : route.page === 'rfp-compare' ? 'max-w-[92rem]' : 'max-w-[70rem]'}`}>
          <ErrorBoundary resetKey={hash}>
          {route.page === 'home' && <HomePage />}
          {route.page === 'notices' && <NoticesPage />}
          {route.page === 'mails' && <MailsPage tab={route.tab} />}
          {route.page === 'evaluations' && <EvaluationsPage />}
          {route.page === 'rfp' && <RfpPage key={`${route.query.next ?? ''}|${route.query.prev ?? ''}`} query={route.query} />}
          {route.page === 'rfp-compare' && <CompareResultPage key={route.compareId} compareId={route.compareId} />}
          {route.page === 'stats' && <StatsPage />}
          {route.page === 'evaluation' && <EvaluationDetailPage key={route.noticeId} noticeId={route.noticeId} />}
          {route.page === 'recipients' && <RecipientsPage />}
          {route.page === 'templates' && <TemplatesPage />}
          {route.page === 'template' && <TemplateEditor key={route.id} id={route.id} />}
          {route.page === 'mail' && <MailPreparePage key={route.noticeId} noticeId={route.noticeId} from={route.query.from} />}
          {route.page === 'notice' && <NoticeDetailPage key={route.noticeId} noticeId={route.noticeId} tab={route.tab} handoff={parseHandoffReasons(route.query.handoff)} />}
          {route.page === 'settings' && <SettingsPage section={settingsSectionOf(hash)} nonce={hash} />}
          </ErrorBoundary>
        </div>
      </main>
      <EvalAutoDock onEvaluations={route.page === 'evaluations'} />
    </div>
  );
}
