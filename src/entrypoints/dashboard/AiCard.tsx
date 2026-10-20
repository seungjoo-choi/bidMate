import { ClipboardPaste, FlaskConical, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AiMode, AiProvider } from '../../core/types/ai';
import type { Settings } from '../../core/types/settings';
import { PROVIDERS } from '../../engine/ai/providers';
import { send } from '../../messaging/bus';
import { Button, Card, Field, InlineAlert, Select, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';
import { formatChars, keyTails, mergeAiKey, modelOptions, originPattern, type ModelInfo } from './ai-card-logic';

type Secrets = { g2bServiceKey?: string; ai?: Partial<Record<AiProvider, string>>; [k: string]: unknown };

const ORDER: AiProvider[] = ['claude', 'openai', 'gemini'];
const MODES: Array<{ id: AiMode; label: string }> = [
  { id: 'api', label: 'API 호출' },
  { id: 'manual', label: '반자동 붙여넣기' },
];

const NOTICE: Record<AiProvider, string> = {
  claude: '종량제이며 비용은 해당 계정에 청구됩니다.',
  openai: '종량제이며 비용은 해당 계정에 청구됩니다.',
  gemini: '무료 등급은 분당·일일 호출 제한이 있고, 입력 내용이 Google 서비스 개선에 쓰일 수 있습니다(공고문은 공개 자료).',
};

export function AiCard() {
  const { settings, save } = useSettings();
  // 키 원문은 상태에 두지 않는다. 끝 4자리 표시값만 보관한다
  const [keys, setKeys] = useState<Partial<Record<AiProvider, string>>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'clip' | null>(null);
  const [models, setModels] = useState<Partial<Record<AiProvider, ModelInfo[]>>>({});
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');

  const load = async () => {
    const { secrets } = await chrome.storage.local.get('secrets');
    setKeys(keyTails((secrets as Secrets | undefined)?.ai));
  };
  useEffect(() => { void load(); }, []);

  const provider = settings?.ai.provider ?? 'gemini';
  const mode = settings?.ai.mode ?? 'api';
  const model = settings?.ai.models[provider] ?? '';
  useEffect(() => { setModelDraft(model); }, [model, provider]);

  const latest = useRef(settings);
  useEffect(() => { latest.current = settings; }, [settings]);

  if (!settings) return <Card title="AI로 다시 찾기" />;

  const cur = settings;
  const adapter = PROVIDERS[provider];
  const list = models[provider] ?? [];
  const saved = keys[provider] ?? null;

  // 저장 직전의 최신 설정에 병합한다(빠른 연속 변경이 서로 덮어쓰지 않게 ref로 최신값 유지)
  const patchAi = async (patch: (ai: Settings['ai']) => Partial<Settings['ai']>) => {
    setError(null);
    try {
      const base = latest.current ?? cur;
      const next = { ...base, ai: { ...base.ai, ...patch(base.ai) } };
      latest.current = next;
      await save(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pickProvider = (p: AiProvider) => {
    setInput('');
    setTestMsg(null);
    setWarn(null);
    setNote(null);
    void patchAi(() => ({ provider: p }));
  };
  const setModel = (id: string) => {
    const v = id.trim();
    if (v === model) return;
    void patchAi((ai) => ({ models: { ...ai.models, [provider]: v } }));
  };

  const saveKey = async () => {
    const key = input.trim();
    if (!key) return;
    setError(null);
    setWarn(null);
    setNote(null);
    // 사용자 제스처 안에서 첫 await로 호출해야 한다.
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [originPattern(adapter.apiOrigin)] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy('save');
    try {
      const { secrets } = await chrome.storage.local.get('secrets');
      await chrome.storage.local.set({ secrets: mergeAiKey(secrets as Secrets | undefined, provider, key) });
      setInput('');
      await load();
      if (!granted) setWarn('권한 없이는 호출할 수 없습니다. 키는 저장했지만 [저장]을 다시 눌러 접근 권한을 허용해야 AI를 사용할 수 있습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setError(null);
    setTestMsg(null);
    try {
      const r = await send('ai/test', { provider }, { timeoutMs: 30_000 });
      if (r.ok) {
        const ms = r.models ?? [];
        setModels((m) => ({ ...m, [provider]: ms }));
        setTestMsg({ ok: true, text: ms.length ? `연결 성공: 모델 ${ms.length}개` : '연결 성공 (모델 목록을 받지 못했습니다. 모델명을 직접 입력하세요)' });
      } else {
        setTestMsg({ ok: false, text: `${r.error?.code ?? 'ERROR'}: ${r.error?.message ?? '연결에 실패했습니다.'}` });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const allowClipboard = async () => {
    setError(null);
    setNote(null);
    setBusy('clip');
    try {
      const ok = await chrome.permissions.request({ permissions: ['clipboardRead'] });
      setNote(ok ? '클립보드 읽기 권한을 허용했습니다.' : '클립보드 읽기 권한이 허용되지 않았습니다. 붙여넣기 칸에 직접 붙여넣을 수 있습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="AI로 다시 찾기" description="확인 화면에서 [AI로 다시 찾기]를 누르면 AI가 공고문에서 항목을 다시 찾아 제안합니다. 제안은 [적용]해야 값이 들어갑니다. 키는 이 브라우저에만 저장됩니다.">
      <Field label="공급자">
        <div className="space-y-1.5">
          {ORDER.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="radio" name="ai-provider" className="accent-current" checked={provider === p} onChange={() => pickProvider(p)} />
              {PROVIDERS[p].label}
              {p !== provider && (keys[p] ? <StatusBadge status="ok">저장됨</StatusBadge> : <StatusBadge status="idle">미설정</StatusBadge>)}
            </label>
          ))}
        </div>
      </Field>

      <Field label="방식">
        <div className="space-y-1.5">
          {MODES.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="ai-mode" className="accent-current" checked={mode === m.id} onChange={() => void patchAi(() => ({ mode: m.id }))} />
              {m.label}
            </label>
          ))}
        </div>
      </Field>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-ink">{adapter.label} 키</span>
          {saved ? <StatusBadge status="ok">저장됨 (끝 4자리 {saved})</StatusBadge> : <StatusBadge status="idle">미설정</StatusBadge>}
        </div>
        <Field label="API 키" htmlFor="ai-key">
          <input id="ai-key" type="password" autoComplete="off" className={inputClass} value={input} onChange={(e) => setInput(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Save />} loading={busy === 'save'} disabled={!input.trim()} onClick={saveKey}>저장</Button>
          <Button variant="secondary" icon={<FlaskConical />} loading={busy === 'test'} disabled={!saved} onClick={() => void runTest()}>연결 테스트</Button>
        </div>
        {testMsg && <InlineAlert tone={testMsg.ok ? 'ok' : 'error'}>{testMsg.text}</InlineAlert>}

        <Field label="모델" htmlFor="ai-model" help="[연결 테스트]를 하면 사용 가능한 모델 목록이 나옵니다. 목록이 없으면 모델명을 직접 입력하세요.">
          {list.length > 0 ? (
            <Select id="ai-model" aria-label="모델" value={model} options={modelOptions(list, model)} onChange={setModel} />
          ) : (
            <input
              id="ai-model"
              className={inputClass}
              autoComplete="off"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => setModel(modelDraft)}
            />
          )}
        </Field>

        <p className="text-xs text-muted">{NOTICE[provider]} 키는 이 브라우저에만 저장됩니다.</p>
      </div>

      {mode === 'manual' && (
        <div className="space-y-2 text-sm">
          <p>열릴 사이트: {adapter.webUrl}</p>
          <p className="text-xs text-muted">요청문이 클립보드에 복사되고 위 사이트가 새 탭으로 열립니다. 붙여넣기 상한은 {formatChars(adapter.manualMaxChars)}입니다. 답변(코드 블록)을 복사해 확인 화면에 붙여넣습니다.</p>
          <Button variant="secondary" icon={<ClipboardPaste />} loading={busy === 'clip'} onClick={() => void allowClipboard()}>클립보드 읽기 권한 허용 (선택)</Button>
        </div>
      )}

      {warn && <InlineAlert tone="warn">{warn}</InlineAlert>}
      {note && <InlineAlert tone="info">{note}</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
