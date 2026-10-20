import { useCallback, useEffect, useState } from 'react';
import { send } from '../../messaging/bus';
import { AI_BATCH_SESSION_KEY, type AiBatchState, type AiProvider } from '../../core/types/ai';
import { batchActive } from '../review/ai-batch-view';

/**
 * storage.session `aiBatch`(일괄 실행 상태)를 구독한다. 마운트 때 세션이 running/waiting이면 `ai/batch-get`을 1회 불러
 * 고아(offscreen 재시작 등)를 정리한 상태로 맞춘다.
 */
export function useAiBatch() {
  const [state, setState] = useState<AiBatchState | null>(null);

  useEffect(() => {
    let alive = true;
    let first = true;
    const load = async () => {
      const s = ((await chrome.storage.session.get(AI_BATCH_SESSION_KEY))[AI_BATCH_SESSION_KEY] as AiBatchState | undefined) ?? null;
      if (!alive) return;
      setState(s);
      if (first) {
        first = false;
        if (batchActive(s)) {
          try { const r = await send('ai/batch-get', {}); if (alive) setState(r); } catch { /* 세션 값을 유지 */ }
        }
      }
    };
    void load();
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && c[AI_BATCH_SESSION_KEY]) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  /** 일괄 실행 시작. 오류는 던진다(code 보존). */
  const start = useCallback(async (noticeIds: string[], provider?: AiProvider) => {
    const r = await send('ai/batch-run', { noticeIds, ...(provider ? { provider } : {}) }, { timeoutMs: 40_000 });
    return r.batchId;
  }, []);
  const cancel = useCallback(async (batchId: string) => { await send('ai/batch-cancel', { batchId }); }, []);
  /** 끝난 배치 패널을 닫는다(세션 삭제). */
  const clear = useCallback(async (batchId: string) => { await send('ai/batch-clear', { batchId }); setState(null); }, []);

  return { state, start, cancel, clear };
}
