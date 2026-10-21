import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareSets } from '../../../core/rfp/match';
import type { RequirementSet, RfpCompareResult, RfpCompareSession } from '../../../core/types/rfp';
import { send } from '../../../messaging/bus';
import { summaryOf, swapSessionDirection } from './compare-view-logic';

export type CompareLoad =
  | { kind: 'loading'; step: string }
  | { kind: 'no-session' }
  | { kind: 'doc-missing'; side: 'prev' | 'next'; message: string }
  | { kind: 'ready' };

const SAVE_DELAY_MS = 500;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EMPTY: RfpCompareResult = { pairs: [], counts: { same: 0, changed: 0, added: 0, removed: 0 }, prefixes: [] };

/** 세션 로드 → 두 문서 요구사항 추출 → 비교 계산. 세션 변경은 즉시 반영하고 500ms 뒤 저장한다. */
export function useCompareSession(compareId: string) {
  const [load, setLoad] = useState<CompareLoad>({ kind: 'loading', step: '비교 기록을 불러오는 중…' });
  const [session, setSession] = useState<RfpCompareSession | null>(null);
  const [sets, setSets] = useState<{ prev: RequirementSet; next: RequirementSet } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ver = useRef(0);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading', step: '비교 기록을 불러오는 중…' });
    setSession(null); setSets(null); setDirty(false); setSaveError(null);
    (async () => {
      let s: RfpCompareSession | null;
      try { s = await send('rfp/compare-get', { compareId }); } catch { s = null; }
      if (!alive) return;
      if (!s) { setLoad({ kind: 'no-session' }); return; }
      setSession(s);
      setLoad({ kind: 'loading', step: '두 문서에서 요구사항을 찾는 중… (처음 여는 문서는 1분 가까이 걸릴 수 있어요)' });
      const [a, b] = await Promise.allSettled([
        send('rfp/extract', { ref: s.prev.ref }, { timeoutMs: 100_000 }),
        send('rfp/extract', { ref: s.next.ref }, { timeoutMs: 100_000 }),
      ]);
      if (!alive) return;
      if (a.status === 'rejected') { setLoad({ kind: 'doc-missing', side: 'prev', message: errText(a.reason) }); return; }
      if (b.status === 'rejected') { setLoad({ kind: 'doc-missing', side: 'next', message: errText(b.reason) }); return; }
      setSets({ prev: a.value, next: b.value });
      setLoad({ kind: 'ready' });
    })();
    return () => { alive = false; };
  }, [compareId]);

  const result = useMemo(
    () => (sets && session ? compareSets(sets.prev.items, sets.next.items, session.overrides) : EMPTY),
    [sets, session?.overrides], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const latest = useRef({ session, result, dirty });
  latest.current = { session, result, dirty };

  const save = useCallback(async () => {
    const { session: s, result: r } = latest.current;
    if (!s) return;
    const v = ver.current;
    try {
      await send('rfp/compare-save', { session: { ...s, summary: summaryOf(r) } });
      setSaveError(null);
      if (ver.current === v) setDirty(false);
    } catch (e) {
      setSaveError(errText(e));
    }
  }, []);

  useEffect(() => {
    if (!dirty || load.kind !== 'ready') return;
    const t = setTimeout(() => { void save(); }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirty, session, load.kind, save]);

  // 화면을 떠날 때 못 보낸 변경이 있으면 바로 보낸다
  useEffect(() => () => {
    const { session: s, result: r, dirty: d } = latest.current;
    if (d && s) void send('rfp/compare-save', { session: { ...s, summary: summaryOf(r) } }).catch(() => undefined);
  }, []);

  const update = useCallback((fn: (s: RfpCompareSession) => RfpCompareSession) => {
    ver.current++;
    setSession((s) => (s ? fn(s) : s));
    setDirty(true);
  }, []);

  /** 비교 대상↔기준 교체(세션·추출 결과 함께). 확인함은 비운다. */
  const swapDirection = useCallback(() => {
    update(swapSessionDirection);
    setSets((x) => (x ? { prev: x.next, next: x.prev } : x));
  }, [update]);

  return { load, session, prevSet: sets?.prev ?? null, nextSet: sets?.next ?? null, result, update, swapDirection, saveError, retrySave: save };
}
