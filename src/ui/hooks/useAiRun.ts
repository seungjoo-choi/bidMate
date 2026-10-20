import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '../../messaging/bus';
import { AI_RUN_SESSION_PREFIX, type AiProvider, type AiReviewFile, type AiRunState } from '../../core/types/ai';
import { terminalSignal } from '../review/ai-view';

/**
 * storage.session `aiRun.<noticeId>`(진행 상태)를 구독하고 `ai/get`으로 run 파일을 읽는다.
 * 진행 상태가 done/failed/cancelled로 바뀌면 다시 읽는다(처음부터 끝난 상태였다면 다시 읽지 않는다). review가 undefined면 아직 읽는 중.
 * 공고가 바뀌면 이전 공고의 늦은 응답은 버린다. noticeId가 비어 있으면 send·구독 없이 state·review를 null로 둔다.
 */
export function useAiRun(noticeId: string | null | undefined) {
  const [state, setState] = useState<AiRunState | null>(null);
  const [review, setReview] = useState<AiReviewFile | null | undefined>(undefined);
  const handled = useRef<string | null>(null);
  const current = useRef(noticeId);
  current.current = noticeId;
  const key = noticeId ? `${AI_RUN_SESSION_PREFIX}${noticeId}` : null;

  const reload = useCallback(async () => {
    const id = noticeId;
    if (!id) return;
    try {
      const r = await send('ai/get', { noticeId: id });
      if (current.current === id) setReview(r);
    } catch {
      if (current.current === id) setReview((r) => (r === undefined ? null : r));
    }
  }, [noticeId]);

  useEffect(() => {
    if (!noticeId) { setReview(null); return; }
    setReview(undefined);
    void reload();
  }, [noticeId, reload]);

  useEffect(() => {
    let alive = true;
    let first = true;
    handled.current = null;
    setState(null);
    if (!key) return;
    const load = async () => {
      const s = ((await chrome.storage.session.get(key))[key] as AiRunState | undefined) ?? null;
      if (!alive) return;
      // 처음 읽은 상태가 이미 끝난 상태면 마운트 때 한 번 읽은 ai/get과 중복이므로 재조회하지 않는다.
      if (first) { first = false; handled.current = terminalSignal(s); }
      setState(s);
    };
    void load();
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && c[key]) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, [key]);

  useEffect(() => {
    const sig = terminalSignal(state);
    if (!sig || handled.current === sig) return;
    handled.current = sig;
    void reload();
  }, [state, reload]);

  return { state, review, reload, setReview };
}

/**
 * 공급자별 API 키 보유 여부(boolean)만 돌려준다. 값은 상태에 두지 않는다. null이면 아직 읽는 중.
 * 키 저장 위치(storage.local secrets.ai)는 설정 화면(G2bCard)과 같다.
 */
export function useAiKeyPresence(): Record<AiProvider, boolean> | null {
  const [has, setHas] = useState<Record<AiProvider, boolean> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { secrets } = await chrome.storage.local.get('secrets');
      if (!alive) return;
      const ai = (secrets as { ai?: Partial<Record<AiProvider, string>> } | undefined)?.ai ?? {};
      setHas({ claude: !!ai.claude?.trim(), openai: !!ai.openai?.trim(), gemini: !!ai.gemini?.trim() });
    };
    void load();
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && c.secrets) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);
  return has;
}
