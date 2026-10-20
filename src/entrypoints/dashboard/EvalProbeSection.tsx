import { Save, Search } from 'lucide-react';
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
    <Card title="평가 점수 API 확인" description="개찰이 끝난 협상 공고의 평가 점수를 나라장터 탭에서 조회해 받은 개수를 보여줍니다. [조회]는 확인만 하고, [저장]은 저장 폴더에도 기록합니다.">
      <Field label="공고번호" htmlFor="eval-probe-no">
        {/* 입력칸 하나짜리 폼이라 버튼을 같은 줄 오른쪽에 붙인다(주 버튼이 맨 오른쪽). */}
        <div className="flex flex-wrap gap-2">
          <input id="eval-probe-no" className={`${inputClass} min-w-48 flex-1`} value={text} onChange={(e) => setText(e.target.value)} />
          <Button variant="secondary" icon={<Save />} loading={saving} onClick={() => void collect()}>저장</Button>
          <Button icon={<Search />} loading={busy} onClick={() => void run()}>조회</Button>
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={noIds} onChange={(e) => setNoIds(e.target.checked)} />
        식별 헤더 없이 조회
      </label>
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
