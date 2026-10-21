import { BarChart3, FileText, LayoutDashboard, ListChecks, Mail, Settings as SettingsIcon, Trophy, Users } from 'lucide-react';
import type { Page } from './route';

export const MENU: Array<{ id: Page; label: string; Icon: typeof SettingsIcon }> = [
  { id: 'home', label: '홈', Icon: LayoutDashboard },
  { id: 'notices', label: '공고', Icon: ListChecks },
  { id: 'mails', label: '메일 관리', Icon: Mail },
  { id: 'evaluations', label: '평가분석', Icon: BarChart3 },
  { id: 'stats', label: '실적', Icon: Trophy },
  { id: 'recipients', label: '수신자', Icon: Users },
  { id: 'templates', label: '템플릿', Icon: FileText },
  { id: 'settings', label: '설정', Icon: SettingsIcon },
];

/** 사이드 메뉴와 같은 아이콘을 앞에 붙인 페이지 제목 */
export function PageTitle({ page }: { page: Page }) {
  const item = MENU.find((m) => m.id === page);
  if (!item) return null;
  const { Icon, label } = item;
  return (
    <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
      <Icon className="size-6 shrink-0" aria-hidden />
      {label}
    </h1>
  );
}
