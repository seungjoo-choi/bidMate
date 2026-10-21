import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
type Size = 'md' | 'icon';

// 모든 변형이 그림자 없는 옅은 면+얇은 테두리+굵은 글자. primary(화면의 주 동작 하나)는 옅은 파란 면에 파란 글자로, 채움 없이 구분한다.
// 보조 버튼 면(btn-face)은 카드 면보다 한 톤 낮아 흰 판처럼 떠 보이지 않는다(ghost는 secondary와 같은 모양, 남은 호출부 호환용).
const variants: Record<Variant, string> = {
  primary: 'border-btn-pri-line bg-btn-pri-wash text-btn-pri-ink hover:bg-btn-pri-line/50',
  secondary: 'border-line-strong bg-btn-face text-ink hover:bg-sunken [&_svg]:text-muted',
  ghost: 'border-line-strong bg-btn-face text-ink hover:bg-sunken [&_svg]:text-muted',
  danger: 'border-btn-danger-line bg-danger-wash text-danger hover:bg-btn-danger-line/50',
  ai: 'border-ai-line bg-ai-wash text-ink hover:bg-ai-line/40 [&_svg]:text-ai-ink',
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
