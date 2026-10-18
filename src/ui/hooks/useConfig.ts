import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecipientsSnapshot, TemplatesSnapshot } from '../../core/types/config-file';
import { send } from '../../messaging/bus';
import type { MsgType, PayloadOf, ResponseOf } from '../../messaging/protocol';

export interface ConfigError { code?: string; message: string; path?: string }
export type RunResult = { ok: true } | { ok: false; error: { code: string; message: string; path?: string } };

function useSnapshot<S, T extends MsgType>(listType: T, listPayload: PayloadOf<T>) {
  const [data, setData] = useState<S | null>(null);
  const [error, setError] = useState<ConfigError | null>(null);
  const [loading, setLoading] = useState(true);
  // 요청마다 증가하는 순번. 가장 최근에 시작한 요청의 응답만 반영한다.
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const latest = () => alive.current && mine === seq.current;
    try {
      const next = (await send(listType, listPayload)) as S;
      if (latest()) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (latest()) setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e), path: (e as { path?: string }).path });
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listType]);
  useEffect(() => { void reload(); }, [reload]);

  /** 변경 메시지를 보내고 성공 시 응답 스냅샷으로 교체한다. 실패 시 data는 그대로 둔다. */
  const run = useCallback(async <M extends MsgType>(type: M, payload: PayloadOf<M>): Promise<RunResult> => {
    const mine = ++seq.current;
    try {
      const next = (await send(type, payload)) as S;
      if (alive.current && mine === seq.current) {
        setData(next);
        setError(null);
      }
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      return { ok: false, error: { code: typeof code === 'string' ? code : 'INTERNAL', message: e instanceof Error ? e.message : String(e), path: (e as { path?: string }).path } };
    }
  }, []);

  return { data, error, loading, reload, run };
}

export function useRecipients() {
  return useSnapshot<RecipientsSnapshot, 'recipients/list'>('recipients/list', undefined);
}

export function useTemplates() {
  return useSnapshot<TemplatesSnapshot, 'templates/list'>('templates/list', undefined);
}
