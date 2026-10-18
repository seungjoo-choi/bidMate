import { FlaskConical, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { send } from '../../messaging/bus';
import type { G2bTestResult } from '../../messaging/protocol';
import { Button, Card, Field, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';

type Secrets = { g2bServiceKey?: string; [k: string]: unknown };

export function G2bCard() {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<G2bTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { secrets } = await chrome.storage.local.get('secrets');
    setSaved((secrets as Secrets | undefined)?.g2bServiceKey ?? null);
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    const key = input.trim();
    if (!key) return;
    setBusy('save');
    setError(null);
    try {
      const { secrets } = await chrome.storage.local.get('secrets');
      await chrome.storage.local.set({ secrets: { ...(secrets as Secrets | undefined), g2bServiceKey: key } });
      setInput('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      setTest(await send('g2b/test', {}, { timeoutMs: 30_000 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="나라장터 OpenAPI" description="공공데이터포털에서 발급받은 서비스키(일반 인증키)를 입력하세요. 키는 이 브라우저에만 저장됩니다.">
      <div className="flex items-center gap-3">
        {saved ? <StatusBadge status="ok">저장됨 (끝 4자리 ****{saved.slice(-4)})</StatusBadge> : <StatusBadge status="idle">미설정</StatusBadge>}
      </div>
      <Field label="서비스키" htmlFor="g2b-key">
        <input id="g2b-key" type="password" autoComplete="off" className={inputClass} value={input} onChange={(e) => setInput(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Save />} loading={busy === 'save'} disabled={!input.trim()} onClick={save}>저장</Button>
        <Button variant="secondary" icon={<FlaskConical />} loading={busy === 'test'} disabled={!saved} onClick={runTest}>연결 테스트</Button>
      </div>
      {test && (
        <InlineAlert tone={test.ok ? 'ok' : 'error'}>
          {test.ok ? <>연결 성공: {test.title}</> : <>{test.error?.code}: {test.error?.message}</>}
        </InlineAlert>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
