import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'ok' | 'warn' | 'error' | 'ai';

const tones = {
  info: { cls: 'border border-accent/20 bg-info-wash', icon: 'text-accent', Icon: Info },
  ok: { cls: 'border border-ok/20 bg-ok-wash', icon: 'text-ok', Icon: CheckCircle2 },
  warn: { cls: 'border border-warn/20 bg-warn-wash', icon: 'text-warn', Icon: TriangleAlert },
  error: { cls: 'border border-danger/20 bg-danger-wash', icon: 'text-danger', Icon: AlertCircle },
  // AI 흐름 안의 안내. 색은 감싼 data-ai(공급자)를 따른다.
  ai: { cls: 'border border-ai-line bg-ai-wash', icon: 'text-ai-ink', Icon: Info },
} as const;

export function InlineAlert({ tone = 'info', leading, children }: { tone?: AlertTone; leading?: ReactNode; children: ReactNode }) {
  const { cls, icon, Icon } = tones[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-ctl px-4 py-3 text-sm text-ink ${cls}`}>
      {leading ?? <Icon className={`mt-[3px] size-4 shrink-0 ${icon}`} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
