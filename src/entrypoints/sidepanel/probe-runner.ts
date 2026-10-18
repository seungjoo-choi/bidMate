// 진단 전용 경로: SW 라우터를 거치지 않고 sidepanel이 직접 주입/호출한다(architecture §1.1과 의도된 차이).
import { maskDeep } from '../../core/privacy/mask';
import type { ProbeReport } from '../../messaging/protocol';

export type ProbeMethod = 'snapshot' | 'inspect' | 'startRecording' | 'stopRecording' | 'status';

export interface FrameResult extends ProbeReport {
  frameId: number;
  documentId?: string;
}

export async function injectProbe(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['probe.js'] });
}

export async function callProbe(tabId: number, method: ProbeMethod, args: unknown[] = []): Promise<FrameResult[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (m: string, a: unknown[]) => {
      const p = (window as unknown as { __bidMateProbe?: Record<string, (...x: unknown[]) => unknown> }).__bidMateProbe;
      const fn = p?.[m];
      return fn ? fn(...a) : { error: 'probe 미주입' };
    },
    args: [method, args],
  });
  return results.map((r) => ({
    frameId: r.frameId,
    documentId: r.documentId,
    ...((r.result as ProbeReport | undefined) ?? { error: 'no result' }),
  }));
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function stamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 리포트 출력 단일 관문: 모든 다운로드는 여기서 meta 포함 전체를 maskDeep으로 통과시킨다.
export async function downloadJson(filename: string, data: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(maskDeep(data), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ filename, url, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function originOf(url: unknown): string | null {
  try { return new URL(String(url)).origin; } catch { return null; }
}

/** 최상위 프레임(frameId 0)의 origin과 같은지 `sameOrigin`을 붙인다. */
export function withSameOrigin<T extends { frameId: number; url?: unknown }>(frames: T[]): Array<T & { sameOrigin: boolean }> {
  const top = originOf(frames.find((f) => f.frameId === 0)?.url);
  return frames.map((f) => ({ ...f, sameOrigin: top !== null && originOf(f.url) === top }));
}
