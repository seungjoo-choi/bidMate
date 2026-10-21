/**
 * 화면 테마(시스템/라이트/다크). 값은 chrome.storage.local에 두어 확장 페이지와 content script(나라장터 패널, 진행 카드)가 함께 읽는다.
 * CSS는 prefers-color-scheme 대신 대상 요소의 data-theme="light|dark"만 본다. 시스템 모드면 여기서 OS 설정을 풀어 넣는다.
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_KEY = 'bm.theme';
/** 확장 페이지에서 첫 그림이 깜박이지 않게 동기로 읽는 사본(content script에서는 사이트 저장소라 쓰지 않는다) */
const CACHE_KEY = 'bm.theme';

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';
const extPage = (): boolean => typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
const darkQuery = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export const resolveTheme = (mode: ThemeMode): 'light' | 'dark' => (mode === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : mode);

function cachedMode(): ThemeMode {
  if (!extPage()) return 'system';
  try { const v = localStorage.getItem(CACHE_KEY); return isMode(v) ? v : 'system'; } catch { return 'system'; }
}

export async function getThemeMode(): Promise<ThemeMode> {
  try { const r = await chrome.storage.local.get(THEME_KEY); return isMode(r[THEME_KEY]) ? r[THEME_KEY] : 'system'; } catch { return cachedMode(); }
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  if (extPage()) { try { localStorage.setItem(CACHE_KEY, mode); } catch { /* 사본은 없어도 된다 */ } }
  await chrome.storage.local.set({ [THEME_KEY]: mode });
}

/** 저장된 테마를 el의 data-theme에 반영하고, 설정·OS 테마가 바뀌면 따라간다. 해제 함수를 돌려준다 */
export function applyTheme(el: HTMLElement): () => void {
  let mode = cachedMode();
  const paint = () => {
    const t = resolveTheme(mode);
    el.dataset.theme = t;
    if (el === document.documentElement) el.style.colorScheme = t;
  };
  paint();
  let off = false;
  void getThemeMode().then((m) => { if (off) return; mode = m; paint(); });
  const onStore = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(THEME_KEY in c)) return;
    const v = c[THEME_KEY]?.newValue;
    mode = isMode(v) ? v : 'system';
    if (extPage()) { try { localStorage.setItem(CACHE_KEY, mode); } catch { /* 무시 */ } }
    paint();
  };
  try { chrome.storage.onChanged.addListener(onStore); } catch { /* 고아 content script */ }
  const q = darkQuery();
  const onOs = () => { if (mode === 'system') paint(); };
  q?.addEventListener('change', onOs);
  return () => {
    off = true;
    try { chrome.storage.onChanged.removeListener(onStore); } catch { /* 무시 */ }
    q?.removeEventListener('change', onOs);
  };
}
