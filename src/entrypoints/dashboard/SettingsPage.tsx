import { Bell, Building2, ClipboardList, FolderOpen, Landmark, Mail, Send, Sparkles, Stethoscope, Tag, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SettingsSection } from '../../messaging/protocol';
import { statusTone } from '../../ui/theme';
import { StorageFolderCard } from './StorageFolderCard';
import { MailServiceCard } from './MailServiceCard';
import { G2bCard } from './G2bCard';
import { AiCard } from './AiCard';
import { CompanyCard } from './CompanyCard';
import { PerformancesCard } from './PerformancesCard';
import { NotifyCard } from './NotifyCard';
import { FileNameCard } from './FileNameCard';
import { AutoComposeCard } from './AutoComposeCard';
import { DiagnosticsPanel } from './diagnostics/DiagnosticsPanel';
import { PageTitle } from './menu';
import type { SettingsView } from './route';
import { useSettingsStatus, type SectionHealth } from './useSettingsStatus';

const HIGHLIGHT_MS = 2400;

type Item = { id: SettingsSection; label: string; Icon: LucideIcon; card: () => ReactNode };
type Group = { id: string; label: string; hint: string; required?: boolean; items: Item[] };

const GROUPS: Group[] = [
  {
    id: 'basic',
    label: '필수 준비',
    hint: '처음 한 번만 설정하면 공고 수집과 메일 작성이 동작합니다.',
    required: true,
    items: [
      { id: 'storage', label: '저장 폴더', Icon: FolderOpen, card: () => <StorageFolderCard /> },
      { id: 'mail-service', label: '메일 서비스', Icon: Mail, card: () => <MailServiceCard /> },
      { id: 'g2b', label: '나라장터 OpenAPI', Icon: Landmark, card: () => <G2bCard /> },
    ],
  },
  {
    id: 'files',
    label: '파일 보관',
    hint: '저장 폴더에 받는 파일의 이름 규칙을 정합니다.',
    items: [
      { id: 'file-name', label: '파일 이름 태그', Icon: Tag, card: () => <FileNameCard /> },
    ],
  },
  {
    id: 'mail',
    label: '메일 자동화',
    hint: '공고 수집이 끝난 뒤 메일 작성으로 이어지는 방식을 정합니다.',
    items: [
      { id: 'auto-compose', label: '자동 메일 작성', Icon: Send, card: () => <AutoComposeCard /> },
    ],
  },
  {
    id: 'extra',
    label: '분석·AI',
    hint: '필요할 때만 설정하세요. 비워 둬도 기본 기능은 그대로 쓸 수 있습니다.',
    items: [
      { id: 'ai', label: 'AI로 다시 찾기', Icon: Sparkles, card: () => <AiCard /> },
      { id: 'company', label: '우리 회사', Icon: Building2, card: () => <CompanyCard /> },
      { id: 'performances', label: '실적 목록', Icon: ClipboardList, card: () => <PerformancesCard /> },
      { id: 'notify', label: '알림', Icon: Bell, card: () => <NotifyCard /> },
    ],
  },
];

const ITEMS = GROUPS.flatMap((g) => g.items.map((item) => ({ ...item, group: g })));
const REQUIRED = GROUPS.filter((g) => g.required).flatMap((g) => g.items);

export function SettingsPage({ section, nonce }: { section?: SettingsView; nonce?: string }) {
  const status = useSettingsStatus();
  const [active, setActive] = useState<SettingsView>(section ?? 'storage');
  const [lit, setLit] = useState<SettingsView | undefined>(section);
  const picked = useRef(!!section);

  // 오류 화면에서 넘어오면 고칠 항목을 열고 잠깐 강조한다
  useEffect(() => {
    setLit(section);
    if (!section) return;
    picked.current = true;
    setActive(section);
    const off = setTimeout(() => setLit(undefined), HIGHLIGHT_MS);
    return () => clearTimeout(off);
  }, [section, nonce]);

  // 그냥 들어오면 아직 안 끝난 필수 항목을 먼저 연다(상태가 처음 들어왔을 때 한 번만)
  const requiredLoaded = REQUIRED.every((i) => status[i.id]);
  const todo = REQUIRED.filter((i) => status[i.id] && status[i.id]!.tone !== 'ok');
  const firstTodo = todo[0]?.id;
  useEffect(() => {
    if (picked.current || !requiredLoaded) return;
    picked.current = true;
    if (firstTodo) setActive(firstTodo);
  }, [requiredLoaded, firstTodo]);

  const open = (id: SettingsView) => {
    picked.current = true;
    setActive(id);
    setLit(undefined);
  };

  const cur = ITEMS.find((i) => i.id === active) ?? ITEMS[0]!;
  const done = REQUIRED.length - todo.length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle page="settings" />
        {requiredLoaded && <Progress done={done} total={REQUIRED.length} next={todo[0]} onOpen={open} />}
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[248px_minmax(0,1fr)]">
        <nav aria-label="설정 항목" className="rounded-card border border-line bg-surface p-2 shadow-card md:sticky md:top-6">
          {GROUPS.map((g, gi) => (
            <div key={g.id} className={gi > 0 ? 'mt-2 border-t border-line pt-2' : ''}>
              <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-xs font-semibold tracking-wide text-muted">
                {g.label}
                {g.required && <span className="rounded-full bg-warn-wash px-1.5 py-px text-[0.6875rem] font-semibold text-warn">필수</span>}
              </div>
              <ul className="grid gap-0.5">
                {g.items.map(({ id, label, Icon }) => {
                  const on = id === active;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => open(id)}
                        className={`flex w-full items-center gap-2.5 rounded-ctl px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none ${
                          on ? 'bg-select font-semibold text-ink' : 'font-medium text-muted hover:bg-sunken hover:text-ink'
                        }`}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <HealthTag health={status[id]} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {/* 개발자용이라 그룹으로 세우지 않고 맨 아래 작은 링크로만 둔다. */}
          <div className="mt-2 border-t border-line pt-2">
            <button
              type="button"
              aria-current={active === 'diagnostics' ? 'page' : undefined}
              onClick={() => open('diagnostics')}
              className={`flex w-full items-center gap-2 rounded-ctl px-3 py-1.5 text-left text-xs transition-colors motion-reduce:transition-none ${
                active === 'diagnostics' ? 'bg-select font-semibold text-ink' : 'text-faint hover:bg-sunken hover:text-muted'
              }`}
            >
              <Stethoscope className="size-3.5 shrink-0" aria-hidden />
              개발자 진단
            </button>
          </div>
        </nav>

        {active === 'diagnostics' ? (
          <div className="min-w-0"><DiagnosticsPanel /></div>
        ) : (
        <div className="min-w-0 space-y-3">
          <p className="flex flex-wrap items-baseline gap-x-2 px-1 text-sm text-muted">
            <span className="font-semibold text-ink">{cur.group.label}</span>
            {cur.group.hint}
          </p>
          <div
            id={`settings-${cur.id}`}
            className={`rounded-card transition-shadow duration-500 motion-reduce:transition-none ${lit === cur.id ? 'ring-2 ring-primary ring-offset-4 ring-offset-canvas' : ''}`}
          >
            {cur.card()}
          </div>
        </div>
        )}
      </div>
    </>
  );
}

/** 메뉴 오른쪽 상태 표시. 끝난 항목은 초록 점, 해야 할 항목은 색 있는 글자로 눈에 띄게 */
function HealthTag({ health }: { health?: SectionHealth }) {
  if (!health) return null;
  if (health.tone === 'ok') {
    return (
      <span className={`flex shrink-0 items-center gap-1.5 text-xs font-normal ${statusTone.ok}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {health.text}
      </span>
    );
  }
  return <span className={`shrink-0 text-xs font-medium ${health.tone === 'idle' ? 'text-faint' : statusTone[health.tone]}`}>{health.text}</span>;
}

function Progress({ done, total, next, onOpen }: { done: number; total: number; next?: Item; onOpen: (id: SettingsSection) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 w-7 rounded-full ${i < done ? 'bg-ok' : 'bg-line-strong'}`} />
        ))}
      </div>
      {next ? (
        <span className="text-muted">
          필수 준비 {done}/{total} 완료 · 다음{' '}
          <button type="button" onClick={() => onOpen(next.id)} className="font-semibold text-accent underline underline-offset-2 hover:text-ink">
            {next.label}
          </button>
        </span>
      ) : (
        <span className={`font-medium ${statusTone.ok}`}>필수 준비 완료</span>
      )}
    </div>
  );
}
