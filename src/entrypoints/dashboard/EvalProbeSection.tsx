import { FlaskConical, Save } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../adapters/g2b/openapi';
import { EVAL_COLLECT_UI_TIMEOUT_MS, EVAL_PROBE_UI_TIMEOUT_MS } from '../../core/evaluation/limits';
import { send } from '../../messaging/bus';
import type { EvalCollectResult, EvalProbeResult } from '../../messaging/protocol';
import { Button, Card, Field, InlineAlert } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';

export function EvalProbeSection() {
  const [text, setText] = useState('R26BK01631407-000');
  const [noIds, setNoIds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvalProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<EvalCollectResult | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    setSaved(null);
    const ref = resolveRef(text);
    if (!ref) { setError('공고번호 형식이 올바르지 않습니다. 예: R26BK01631407-000'); return; }
    setBusy(true);
    try {
      const r = await send('eval/probe', { ref: { noticeNo: ref.noticeNo, ...(ref.round ? { round: ref.round } : {}) }, withoutIdHeaders: noIds }, { timeoutMs: EVAL_PROBE_UI_TIMEOUT_MS });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e));
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    setError(null);
    setResult(null);
    setSaved(null);
    const ref = resolveRef(text);
    if (!ref) { setError('공고번호 형식이 올바르지 않습니다. 예: R26BK01631407-000'); return; }
    setSaving(true);
    try {
      setSaved(await send('eval/collect', { ref: { noticeNo: ref.noticeNo, ...(ref.round ? { round: ref.round } : {}) } }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS }));
    } catch (e) {
      setError(e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="평가 API 시험" description="개찰이 끝난 협상 공고의 평가 점수 API를 나라장터 탭에서 호출해 개수만 확인합니다([시험]은 저장하지 않고, [저장까지]는 저장 폴더에 기록합니다).">
      <Field label="공고번호" htmlFor="eval-probe-no">
        <input id="eval-probe-no" className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={noIds} onChange={(e) => setNoIds(e.target.checked)} />
        식별 헤더 없이
      </label>
      <Button icon={<FlaskConical />} loading={busy} onClick={() => void run()}>시험</Button>
      <Button variant="secondary" icon={<Save />} loading={saving} onClick={() => void collect()}>저장까지</Button>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {saved && (
        <InlineAlert tone={saved.warnings.length > 0 ? 'warn' : 'ok'}>
          저장됨: {saved.noticeId}, 경고 {saved.warnings.length}건, 공식 결과 {saved.entry.hasOfficial ? '있음' : '없음'}
          {saved.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </InlineAlert>
      )}
      {result && (result.ok && result.counts ? (
        <InlineAlert tone="ok">
          업체 {result.counts.targets}, 위원 {result.counts.members}, 세부항목 {result.counts.items}, 점수 {result.counts.scores}, 평가표 {result.counts.sheets} ({result.ms}ms)
        </InlineAlert>
      ) : (
        <InlineAlert tone="error">
          {result.code ?? 'ERROR'}{result.step !== undefined ? `, 단계 ${result.step}` : ''}: {result.message ?? ''} ({result.ms}ms)
        </InlineAlert>
      ))}
    </Card>
  );
}
