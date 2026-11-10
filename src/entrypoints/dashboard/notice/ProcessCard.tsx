import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProcessGetResult } from '../../../core/types/process';
import { send } from '../../../messaging/bus';
import { Button, Card } from '../../../ui/components';
import { processContractRows, processMilestones, processStatusLine, processWinnerRows } from '../../../ui/notice-detail/process-view';
import { DetailList, Timeline } from './parts';

const TITLE = '계약 진행';
const TONE = { muted: 'text-muted', warn: 'text-warn', error: 'text-danger' } as const;

export function ProcessCard({ noticeId }: { noticeId: string }) {
  const [result, setResult] = useState<ProcessGetResult | undefined>();
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 마지막 요청만 반영한다. 공고가 바뀌거나 언마운트되면 이전 응답은 버린다.
  const gen = useRef(0);

  const load = useCallback((force: boolean) => {
    const my = ++gen.current;
    setLoading(true);
    send('process/get', force ? { noticeId, force: true } : { noticeId }, { timeoutMs: 70_000 }).then(
      (r) => { if (gen.current === my) { setResult(r); setFailed(null); setLoading(false); } },
      (e) => { if (gen.current === my) { setFailed(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
  }, [noticeId]);

  useEffect(() => {
    setResult(undefined);
    setFailed(null);
    load(false);
    return () => { gen.current++; };
  }, [load]);

  const reload = () => load(true);
  const action = <Button variant="secondary" disabled={loading} onClick={reload}>다시 조회</Button>;

  if (failed) {
    return <Card title={TITLE} action={action}><p className="text-sm text-danger">조회 실패: {failed}</p></Card>;
  }
  if (!result) return <Card title={TITLE} action={action}><p className="text-sm text-muted">불러오는 중</p></Card>;
  if (result.file === null && !result.error) return null;

  const proc = result.file?.process ?? null;
  const status = processStatusLine(result);
  const winners = proc ? processWinnerRows(proc) : [];
  const contracts = proc ? processContractRows(proc) : [];

  return (
    <Card title={TITLE} action={action}>
      {proc && <Timeline points={processMilestones(proc)} />}
      {winners.length > 0 && <div className="border-t border-line pt-4"><DetailList rows={winners} /></div>}
      {contracts.length > 0 && <div className="border-t border-line pt-4"><DetailList rows={contracts} /></div>}
      <p className={`text-sm ${TONE[status.tone]}`}>
        {status.text}
        {result.error?.code === 'G2B_KEY_MISSING' && <> <a className="text-primary underline" href="#/settings?section=g2b">설정에서 등록</a></>}
      </p>
    </Card>
  );
}
