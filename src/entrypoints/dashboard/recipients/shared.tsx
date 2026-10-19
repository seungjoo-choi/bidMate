import { Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Recipient } from '../../../core/types/recipient';
import { Button, ConfirmDialog, inputClass, Select } from '../../../ui/components';
import { matchesQuery } from '../../../ui/components/select-filter';

export interface OpError { code: string; message: string; path?: string }

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
  DUPLICATE_EMAIL: '이미 등록된 이메일입니다.',
  DUPLICATE_NAME: '같은 이름의 그룹이 이미 있습니다.',
  INVALID_VALUE: '입력값이 올바르지 않습니다. 이름은 필수이며 길이 제한을 확인해 주세요.',
  NOT_FOUND: '대상을 찾을 수 없습니다. 목록을 새로 불러와 주세요.',
  NEEDS_SITE_PERMISSION: '네이버웍스 연락처(contact.worksmobile.com) 접근이 허용되지 않았습니다.',
  NW_NOT_LOGGED_IN: '네이버웍스에 로그인되어 있지 않습니다. 열린 탭에서 로그인한 뒤 [다시 시도]를 눌러 주세요.',
  NW_API_ERROR: '네이버웍스 연락처 방식이 바뀌었을 수 있어 불러오지 못했습니다. (코드: NW_API_ERROR)',
  NW_BAD_RESPONSE: '네이버웍스 연락처 방식이 바뀌었을 수 있어 불러오지 못했습니다. (코드: NW_BAD_RESPONSE)',
  NW_INJECT_FAILED: '네이버웍스 연락처 방식이 바뀌었을 수 있어 불러오지 못했습니다. (코드: NW_INJECT_FAILED)',
  NW_TAB_TIMEOUT: '응답이 늦어 중단했습니다. 네이버웍스 탭을 닫고 다시 시도해 주세요.',
};

export function errorText(e: OpError): string {
  return MESSAGES[e.code] ?? `${e.code}: ${e.message}`;
}

/** 누르면 확인 팝업을 띄우고, 팝업에서 삭제를 눌러야 onConfirm을 부르는 삭제 버튼. */
export function ConfirmDeleteButton({ onConfirm, disabled, title = '삭제할까요?', description, variant = 'ghost' }: { onConfirm: () => void; disabled?: boolean; title?: string; description?: ReactNode; variant?: 'ghost' | 'secondary' }) {
  const [open, setOpen] = useState(false);
  const cancel = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant={variant} icon={<Trash2 />} disabled={disabled} onClick={() => setOpen(true)} className="text-danger">삭제</Button>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        onCancel={cancel}
        onConfirm={() => { setOpen(false); onConfirm(); }}
      />
    </>
  );
}

export type Role = 'to' | 'cc';
export const ROLE_LABEL: Record<Role, string> = { to: '받는 사람', cc: '참조' };

/** 켜고 끄는 스위치. 누르는 즉시 onChange를 부른다. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 motion-reduce:transition-none ${checked ? 'border-accent bg-accent' : 'border-line-strong bg-sunken'}`}
    >
      <span aria-hidden className={`absolute size-4 rounded-full bg-surface shadow-btn transition-transform motion-reduce:transition-none ${checked ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

/** 받는 사람/참조 중 하나를 고르는 두 칸 버튼. */
export function RoleToggle({ value, onChange, disabled, label }: { value: Role; onChange: (v: Role) => void; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-ctl border border-line-strong bg-sunken p-0.5">
      {(['to', 'cc'] as const).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          disabled={disabled}
          onClick={() => { if (value !== r) onChange(r); }}
          className={`h-8 rounded-[5px] px-3 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-40 motion-reduce:transition-none ${value === r ? 'bg-surface text-ink shadow-btn' : 'text-muted hover:text-ink'}`}
        >
          {ROLE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/** 화면 가운데 뜨는 팝업. 바깥을 누르거나 Esc를 누르면 닫힌다. */
export function Modal({ open, title, onClose, size = 'md', children }: { open: boolean; title: string; onClose: () => void; size?: 'md' | 'xl'; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[calc(100vh-2rem)] w-full ${size === 'xl' ? 'max-w-3xl' : 'max-w-lg'} flex-col rounded-card border border-line bg-surface shadow-overlay`}>
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="title-mark text-lg font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="icon" aria-label="닫기" icon={<X />} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type RecipientSort = 'added' | 'recent' | 'name' | 'dept' | 'email' | 'enabled';

const SORT_OPTIONS: { value: RecipientSort; label: string }[] = [
  { value: 'added', label: '등록순' },
  { value: 'recent', label: '최근 등록순' },
  { value: 'name', label: '이름순' },
  { value: 'dept', label: '부서순' },
  { value: 'email', label: '이메일순' },
  { value: 'enabled', label: '발송 켬 먼저' },
];

const byText = (a: string, b: string) => a.localeCompare(b, 'ko');

const COMPARE: Record<Exclude<RecipientSort, 'added' | 'recent'>, (a: Recipient, b: Recipient) => number> = {
  name: (a, b) => byText(a.name, b.name),
  // 부서가 비어 있는 사람은 맨 뒤로.
  dept: (a, b) => (a.dept ? 0 : 1) - (b.dept ? 0 : 1) || byText(a.dept ?? '', b.dept ?? '') || byText(a.name, b.name),
  email: (a, b) => byText(a.email.toLowerCase(), b.email.toLowerCase()),
  enabled: (a, b) => Number(b.enabled) - Number(a.enabled) || byText(a.name, b.name),
};

/** 이름, 부서, 이메일 중 하나라도 검색어에 맞는지(초성 검색 포함). */
export const matchesRecipient = (r: Recipient, q: string) => [r.name, r.email, r.dept ?? ''].some((v) => matchesQuery(v, q));

/** 들어온 배열 순서를 등록순으로 본다. 정렬은 안정 정렬이라 같은 값끼리는 원래 순서를 지킨다. */
export function sortRecipients(list: Recipient[], key: RecipientSort): Recipient[] {
  if (key === 'added') return list;
  if (key === 'recent') return [...list].reverse();
  return [...list].sort(COMPARE[key]);
}

/** 검색 칸과 정렬 선택을 한 줄에. 검색 중이면 몇 명이 걸렸는지 붙인다. */
export function RecipientFilterBar({ q, onQ, sort, onSort, total, matched }: {
  q: string; onQ: (v: string) => void; sort: RecipientSort; onSort: (v: RecipientSort) => void; total: number; matched: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative max-w-sm min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input type="search" aria-label="이름, 부서, 이메일로 찾기" placeholder="이름, 부서, 이메일로 찾기 (초성 가능)" className={`${inputClass} pl-9`} value={q} onChange={(e) => onQ(e.target.value)} />
      </div>
      <Select className="w-36 shrink-0" aria-label="정렬" value={sort} options={SORT_OPTIONS} onChange={(v) => onSort(v as RecipientSort)} />
      {q.trim() && <span className="shrink-0 text-sm text-muted">{total}명 중 {matched}명</span>}
    </div>
  );
}
