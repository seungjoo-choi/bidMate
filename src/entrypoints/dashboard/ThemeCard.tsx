import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, InlineAlert } from '../../ui/components';
import { getThemeMode, setThemeMode, THEME_KEY, type ThemeMode } from '../../ui/theme/mode';

const OPTIONS: { id: ThemeMode; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: 'system', label: '시스템 설정', hint: '컴퓨터 설정을 따라 바뀝니다', Icon: Monitor },
  { id: 'light', label: '라이트', hint: '늘 밝은 화면', Icon: Sun },
  { id: 'dark', label: '다크', hint: '늘 어두운 화면', Icon: Moon },
];

/** 미리보기 조각. 고른 테마와 상관없이 각 모드의 실제 색으로 그린다 */
function Swatch({ mode }: { mode: ThemeMode }) {
  const light = <span className="flex-1" style={{ background: '#f1f3f6' }}><span className="m-1.5 block h-2 rounded-sm" style={{ background: '#fcfcfd' }} /></span>;
  const dark = <span className="flex-1" style={{ background: '#111110' }}><span className="m-1.5 block h-2 rounded-sm" style={{ background: '#1c1c1b' }} /></span>;
  return (
    <span aria-hidden className="flex h-10 w-full overflow-hidden rounded-ctl border border-line">
      {mode === 'dark' ? dark : light}
      {mode === 'system' && dark}
    </span>
  );
}

export function ThemeCard() {
  const [mode, setMode] = useState<ThemeMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getThemeMode().then(setMode);
    // 다른 창(사이드 패널 등)에서 바꿔도 맞춘다
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && THEME_KEY in c) void getThemeMode().then(setMode);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);

  const pick = (m: ThemeMode) => {
    setError(null);
    setMode(m);
    setThemeMode(m).catch((e: unknown) => setError(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <Card title="화면 테마" description="대시보드, 사이드 패널, 나라장터·웹메일에 뜨는 BidMate 패널의 밝기를 정합니다. 고르면 바로 적용됩니다.">
      <div role="radiogroup" aria-label="화면 테마" className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, label, hint, Icon }) => {
          const on = mode === id;
          return (
            <button
              key={id} type="button" role="radio" aria-checked={on} disabled={mode === null} onClick={() => pick(id)}
              className={`flex flex-col gap-2.5 rounded-card border p-3 text-left transition-colors motion-reduce:transition-none ${
                on ? 'border-accent bg-select ring-1 ring-accent' : 'border-line bg-surface hover:bg-sunken'
              }`}
            >
              <Swatch mode={id} />
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon className="size-4 shrink-0" aria-hidden />{label}
              </span>
              <span className="-mt-1.5 text-xs text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
