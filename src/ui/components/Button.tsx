import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
type Size = 'md' | 'icon';

// 모든 변형이 [AI로 다시 찾기]·[AI로 찾기]와 같은 모양이다: 옅은 면+얇은 테두리+본문색 굵은 글자, 색은 아이콘에만.
// 용도는 면·테두리·아이콘 색으로만 구분한다(ghost는 secondary와 같은 모양, 남은 호출부 호환용).
const variants: Record<Variant, string> = {
  primary: 'border-btn-pri-line bg-btn-pri-wash text-ink shadow-btn hover:bg-btn-pri-line/50 [&_svg]:text-btn-pri-ink',
  secondary: 'border-line-strong bg-surface text-ink shadow-btn hover:bg-sunken [&_svg]:text-muted',
  ghost: 'border-line-strong bg-surface text-ink shadow-btn hover:bg-sunken [&_svg]:text-muted',
  danger: 'border-btn-danger-line bg-danger-wash text-danger shadow-btn hover:bg-btn-danger-line/50',
  ai: 'border-ai-line bg-ai-wash text-ink shadow-btn hover:bg-ai-line/40 [&_svg]:text-ai-ink',
};

// 높이는 하나(40px, 입력창과 같음)로 고정한다. icon은 같은 높이의 정사각형.
const sizes: Record<Size, string> = {
  md: 'h-10 gap-1.5 px-4',
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
  // 아이콘이 앞에 붙으면 왼쪽 여백을 줄여 좌우가 눈으로 같아 보이게 한다.
  const leadIcon = size === 'md' && (loading || icon) && children != null ? 'pl-3' : '';
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-btn border text-sm leading-5 font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75] ${sizes[size]} ${leadIcon} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
