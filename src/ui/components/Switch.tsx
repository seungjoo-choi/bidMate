import type { ReactNode } from 'react';

/** 켜기/끄기 토글. 설정의 사용 여부처럼 즉시 상태가 바뀌는 값에 쓴다(여러 개 중 고르기는 체크박스) */
export function Switch({ checked, onChange, disabled, label, id }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; id?: string;
}) {
  const btn = (
    <button
      id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${checked ? 'bg-primary' : 'bg-line-strong'}`}
    >
      <span aria-hidden className={`absolute top-[3px] size-4 rounded-full bg-white shadow-btn transition-[left] motion-reduce:transition-none ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
    </button>
  );
  if (!label) return btn;
  return (
    <label className={`inline-flex items-center gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      {btn}
      <span className="text-sm font-semibold text-ink">{label}</span>
    </label>
  );
}
