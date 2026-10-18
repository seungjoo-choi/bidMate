import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, help, error, htmlFor, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">{label}</label>
      {children}
      {help && !error && <p className="text-xs text-muted">{help}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-ctl border border-line-strong bg-surface inset-shadow-sunken px-3 py-2 text-base leading-[22px] text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20';
