import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

// 상세 화면 맨 위의 뒤로가기. 동그란 화살표 칸+본문보다 옅은 글자, 올리면 글자가 진해지고 화살표가 왼쪽으로 살짝 밀린다.
export function BackLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={`group -ml-1 inline-flex h-8 items-center gap-2 rounded-full pr-3 pl-1 text-sm font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${className}`}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-btn-face transition-[transform,background-color] group-hover:-translate-x-0.5 group-hover:bg-surface motion-reduce:transition-none">
        <ArrowLeft className="size-3.5 stroke-2" aria-hidden />
      </span>
      {children}
    </a>
  );
}
