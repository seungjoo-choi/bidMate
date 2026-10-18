import { useCallback, useEffect, useRef, useState } from 'react';

/** 오른쪽 아래에 2.5초간 표시되는 토스트. `show(text)`로 띄우고 반환된 `node`를 렌더한다. */
export function useToast() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 2500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = text ? <Toast text={text} /> : null;
  return { show, node };
}

export function Toast({ text }: { text: string }) {
  return (
    <div role="status" className="fixed bottom-6 right-6 z-50 rounded-ctl bg-btn shadow-raised px-4 py-2.5 text-sm font-medium text-btn-ink">
      {text}
    </div>
  );
}
