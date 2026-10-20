import { Search } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../adapters/g2b/openapi';
import { send } from '../../messaging/bus';
import type { ProbePart, ResultProbeResult } from '../../core/types/result';
import { Button, Card, Field, InlineAlert } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';

const UI_TIMEOUT_MS = 70_000;

function PartView({ title, part }: { title: string; part: ProbePart }) {
  return (
    <div className="flex flex-col gap-2">
      <InlineAlert tone={part.ok ? 'ok' : 'error'}>
        {title}: {part.ok ? `성공, ${part.count}건` : `실패 ${part.error ?? ''}`}
      </InlineAlert>
      {part.ok && part.count > 0 && (
        <>
          <div className="text-sm text-muted break-all">키: {part.keys.join(', ')}</div>
          <pre className="overflow-x-auto rounded border border-border p-2 text-xs">{JSON.stringify(part.sample, null, 2)}</pre>
        </>
      )}
    </div>
  );
}

export function ResultProbeSection() {
  const [text, setText] = useState('R26BK01631407');
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
      setError(e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="낙찰 결과 API 확인" description="공고번호로 개찰결과와 낙찰정보 API 응답을 확인합니다. 저장하지 않습니다.">
      <Field label="공고번호" htmlFor="result-probe-no">
        <div className="flex flex-wrap gap-2">
          <input id="result-probe-no" className={`${inputClass} min-w-48 flex-1`} value={text} onChange={(e) => setText(e.target.value)} />
          <Button icon={<Search />} loading={busy} onClick={() => void run()}>확인</Button>
        </div>
      </Field>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {result && (
        <div className="flex flex-col gap-4">
          <PartView title="1단계 개찰결과" part={result.opening} />
          {result.award.map((a) => <PartView key={a.op} title={`2단계 ${a.op}`} part={a} />)}
        </div>
      )}
    </Card>
  );
}
