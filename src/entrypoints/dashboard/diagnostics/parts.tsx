import type { ReactNode } from 'react';
import { StatusBadge, type BadgeStatus } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';

export const errText = (e: unknown) =>
  e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e);

/** 도구마다 같은 모양: 설명 한 줄 + 공고번호 입력 + 오른쪽 버튼(주 버튼이 맨 오른쪽) */
export function NoticeInput({ id, value, onChange, help, children }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  help: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">공고번호</label>
        <input
          id={id}
          className={`${inputClass} min-w-48 flex-1 font-mono tabular-nums`}
          placeholder="공고번호"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {children}
      </div>
    </div>
  );
}

/** 실행 결과 한 덩어리. 머리줄(상태·제목·보조 정보) 아래에 세부 내용을 둔다. */
export function ResultBlock({ tone, title, meta, children }: {
  tone: BadgeStatus;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-ctl border border-line bg-sunken inset-shadow-sunken">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
        <StatusBadge status={tone}><span className="font-semibold">{title}</span></StatusBadge>
        {meta && <div className="flex items-center gap-2 text-xs text-muted tabular-nums">{meta}</div>}
      </div>
      {children && <div className="space-y-3 border-t border-line px-4 py-3 text-sm">{children}</div>}
    </div>
  );
}

/** 숫자 몇 개를 이름과 함께 한 줄에 늘어놓는다. */
export function Metrics({ items }: { items: Array<[label: string, value: ReactNode]> }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 원본 응답처럼 길고 가끔만 보는 내용은 접어 둔다. */
export function RawDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-muted select-none hover:text-ink">{summary}</summary>
      <div className="mt-2 min-w-0">{children}</div>
    </details>
  );
}

export function Code({ children }: { children: string }) {
  return <pre className="max-h-72 overflow-auto rounded-ctl border border-line bg-surface p-3 font-mono text-xs leading-relaxed">{children}</pre>;
}
