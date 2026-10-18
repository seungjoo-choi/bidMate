import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'icon';

// 모든 변형이 1px 테두리를 가져서 높이가 같다(primary, ghost는 테두리 색만 배경과 같거나 투명).
const variants: Record<Variant, string> = {
  primary: 'border-primary bg-primary text-primary-ink hover:border-primary-hover hover:bg-primary-hover',
  secondary: 'border-transparent bg-select text-ink hover:bg-select-hover',
  ghost: 'border-transparent text-muted hover:bg-sunken hover:text-ink',
  danger: 'border-danger bg-danger text-surface hover:brightness-110',
};

// 높이는 하나(40px, 입력창과 같음)로 고정한다. icon은 같은 높이의 정사각형.
const sizes: Record<Size, string> = {
  md: 'h-10 gap-2 px-4',
  icon: 'size-10 shrink-0 px-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, disabled, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-btn border text-sm leading-none font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
