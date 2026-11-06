import { Search } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../../adapters/g2b/openapi';
import type { ProbePart, ResultProbeResult } from '../../../core/types/result';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { Code, NoticeInput, RawDetails, ResultBlock, errText } from './parts';

const UI_TIMEOUT_MS = 70_000;

function PartView({ step, title, part }: { step: string; title: string; part: ProbePart }) {
  return (
    <ResultBlock
      tone={part.ok ? (part.count > 0 ? 'ok' : 'idle') : 'error'}
      title={<><span className="font-normal text-muted">{step}</span> {title}</>}
      meta={part.ok ? `${part.count}건` : '실패'}
    >
      {!part.ok && <div className="text-danger wrap-anywhere">{part.error ?? '응답을 받지 못했습니다.'}</div>}
      {part.ok && part.count > 0 && (
        <>
          <div className="text-xs text-muted wrap-anywhere">
            <span className="font-medium text-ink">필드 {part.keys.length}개</span> · {part.keys.join(', ')}
          </div>
          <RawDetails summary="응답 예시 보기">
            <Code>{JSON.stringify(part.sample, null, 2)}</Code>
          </RawDetails>
        </>
      )}
    </ResultBlock>
  );
}

export function ResultProbeTool() {
  const [text, setText] = useState('R26BK01789254');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultProbeResult | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    const ref = resolveRef(text);
    if (!ref) { setError('공고번호 형식이 올바르지 않습니다. 예: R26BK01631407'); return; }
    setBusy(true);
    try {
      setResult(await send('result/probe', { noticeNo: ref.noticeNo }, { timeoutMs: UI_TIMEOUT_MS }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <NoticeInput id="diag-result-no" value={text} onChange={setText} help="공고정보, 개찰결과, 유찰 목록, 낙찰정보 API 응답을 확인합니다. 저장하지 않습니다.">
        <Button icon={<Search />} loading={busy} onClick={() => void run()}>확인</Button>
      </NoticeInput>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {result && (
        <div className="space-y-3">
          <PartView step="0" title={result.notice.op ? `공고정보 ${result.notice.op}` : '공고정보'} part={result.notice} />
          <PartView step="1" title="개찰결과" part={result.opening} />
          {result.failing.map((a) => <PartView key={a.op} step="2 유찰 목록" title={a.op} part={a} />)}
          {result.award.map((a) => <PartView key={a.op} step="3 낙찰정보" title={a.op} part={a} />)}
        </div>
      )}
    </div>
  );
}
