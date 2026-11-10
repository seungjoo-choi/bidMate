import { Check, Copy, ExternalLink, FlaskConical, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { send } from '../../messaging/bus';
import { copyText } from '../../ui/clipboard';
import type { G2bTestResult } from '../../messaging/protocol';
import { Button, Card, Field, FormActions, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';

type Secrets = { g2bServiceKey?: string; [k: string]: unknown };

/** 활용신청이 필요한 공공데이터포털 서비스. id는 data.go.kr/data/{id}/openapi.do 경로. */
const G2B_SERVICES = [
  { id: '15129394', name: '입찰공고정보서비스', use: '공고 수집·재공고' },
  { id: '15129397', name: '낙찰정보서비스', use: '개찰·낙찰 결과' },
  { id: '15129437', name: '사전규격정보서비스', use: '사전규격' },
  { id: '15129459', name: '계약과정통합공개서비스', use: '진행 과정' },
] as const;

/** 활용신청서 '상세기능' 칸 예시. 4개 서비스에 같은 문장을 써도 된다. */
const APPLY_TEXT = '입찰 업무 관리용 브라우저 확장 프로그램에서 나라장터 입찰공고, 사전규격, 개찰·낙찰 결과, 계약 진행 과정을 조회해 관심 공고를 정리하고 결과를 확인하는 데 사용합니다. 조회한 데이터는 개인 업무 참고용으로만 쓰며 외부에 재배포하지 않습니다.';

const linkClass = 'inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline [&_svg]:size-3.5 [&_svg]:text-muted';

export function G2bCard() {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'test-prespec' | null>(null);
  const [test, setTest] = useState<G2bTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const runTest = async (kind?: 'prespec') => {
    setBusy(kind ? 'test-prespec' : 'test');
    setError(null);
    setTest(null);
    try {
      setTest(await send('g2b/test', kind ? { kind } : {}, { timeoutMs: 30_000 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="나라장터 OpenAPI" description="공공데이터포털에서 발급받은 서비스키(일반 인증키)를 입력하세요. 키는 이 브라우저에만 저장됩니다. 키 하나로 아래 4개 서비스를 쓰지만, 활용신청은 서비스마다 따로 해야 합니다.">
      <ul className="flex flex-col gap-1.5">
        {G2B_SERVICES.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <a href={`https://www.data.go.kr/data/${s.id}/openapi.do`} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {s.name}<ExternalLink />
            </a>
            <span className="text-xs text-muted">{s.use}</span>
          </li>
        ))}
      </ul>
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted select-none hover:text-ink">신청서 작성 예시</summary>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p><span className="text-muted">활용목적</span> 기타 (또는 참고자료)</p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">상세기능</span>
              <button type="button" className={linkClass} onClick={() => void copyText(APPLY_TEXT).then(() => setCopied(true), () => setCopied(false))}>
                {copied ? <Check /> : <Copy />}{copied ? '복사됨' : '복사'}
              </button>
            </div>
            <p className="rounded-ctl border border-line bg-surface p-3 text-xs leading-relaxed">{APPLY_TEXT}</p>
          </div>
          <p className="text-xs text-muted">4개 서비스 모두 같은 문장으로 신청해도 됩니다. 개발계정은 보통 바로 자동승인되고, 승인 직후 몇 분은 키 오류가 날 수 있습니다.</p>
        </div>
      </details>
      <div className="flex items-center gap-3">
        {saved ? <StatusBadge status="ok">저장됨 (끝 4자리 ****{saved.slice(-4)})</StatusBadge> : <StatusBadge status="idle">미설정</StatusBadge>}
      </div>
      <Field label="서비스키" htmlFor="g2b-key">
        <input id="g2b-key" type="password" autoComplete="off" className={inputClass} value={input} onChange={(e) => setInput(e.target.value)} />
      </Field>
      <FormActions>
        <Button variant="secondary" icon={<FlaskConical />} loading={busy === 'test'} disabled={!saved} onClick={() => void runTest()}>연결 테스트</Button>
        <Button variant="secondary" icon={<FlaskConical />} loading={busy === 'test-prespec'} disabled={!saved} onClick={() => void runTest('prespec')}>사전규격 API 테스트</Button>
        <Button icon={<Save />} loading={busy === 'save'} disabled={!input.trim()} onClick={save}>저장</Button>
      </FormActions>
      {test && (
        <InlineAlert tone={test.ok ? 'ok' : 'error'}>
          {test.ok ? <>연결 성공: {test.title}</> : <>{test.error?.code}: {test.error?.message}</>}
        </InlineAlert>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
