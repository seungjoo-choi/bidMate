import { Save, Search } from 'lucide-react';
import { useState } from 'react';
import { resolveRef } from '../../../adapters/g2b/openapi';
import { EVAL_COLLECT_UI_TIMEOUT_MS, EVAL_PROBE_UI_TIMEOUT_MS } from '../../../core/evaluation/limits';
import { send } from '../../../messaging/bus';
import type { EvalCollectResult, EvalProbeResult } from '../../../messaging/protocol';
import { Button, InlineAlert } from '../../../ui/components';
import { Metrics, NoticeInput, ResultBlock, errText } from './parts';

export function EvalProbeTool() {
  const [text, setText] = useState('R26BK01631407-000');
  const [noIds, setNoIds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvalProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<EvalCollectResult | null>(null);

  const refOf = () => {
    setError(null);
    setResult(null);
    setSaved(null);
    const ref = resolveRef(text);
    if (!ref) { setError('공고번호 형식이 올바르지 않습니다. 예: R26BK01631407-000'); return null; }
    return { noticeNo: ref.noticeNo, ...(ref.round ? { round: ref.round } : {}) };
  };

  const run = async () => {
    const ref = refOf();
    if (!ref) return;
    setBusy(true);
    try {
      setResult(await send('eval/probe', { ref, withoutIdHeaders: noIds }, { timeoutMs: EVAL_PROBE_UI_TIMEOUT_MS }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    const ref = refOf();
    if (!ref) return;
    setSaving(true);
    try {
      setSaved(await send('eval/collect', { ref }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <NoticeInput
        id="diag-eval-no"
        value={text}
        onChange={setText}
        help="개찰이 끝난 협상 공고의 평가 점수를 나라장터 탭에서 조회합니다. [조회]는 확인만, [저장]은 저장 폴더에도 기록합니다."
      >
        <Button variant="secondary" icon={<Save />} loading={saving} onClick={() => void collect()}>저장</Button>
        <Button icon={<Search />} loading={busy} onClick={() => void run()}>조회</Button>
      </NoticeInput>
      <label className="flex w-fit items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={noIds} onChange={(e) => setNoIds(e.target.checked)} />
        식별 헤더 없이 조회
      </label>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {result && (result.ok && result.counts ? (
        <ResultBlock tone="ok" title="조회 성공" meta={`${result.ms}ms`}>
          <Metrics items={[
            ['업체', result.counts.targets], ['위원', result.counts.members], ['세부항목', result.counts.items],
            ['점수', result.counts.scores], ['평가표', result.counts.sheets],
          ]} />
        </ResultBlock>
      ) : (
        <ResultBlock tone="error" title={`조회 실패 ${result.code ?? 'ERROR'}`} meta={<>{result.step !== undefined && `단계 ${result.step} · `}{result.ms}ms</>}>
          {result.message && <div className="wrap-anywhere">{result.message}</div>}
        </ResultBlock>
      ))}
      {saved && (
        <ResultBlock tone={saved.warnings.length > 0 ? 'warn' : 'ok'} title="저장됨" meta={<span className="font-mono">{saved.noticeId}</span>}>
          <Metrics items={[['경고', saved.warnings.length], ['공식 결과', saved.entry.hasOfficial ? '있음' : '없음']]} />
          {saved.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-warn">
              {saved.warnings.map((w, i) => <li key={i} className="wrap-anywhere">{w}</li>)}
            </ul>
          )}
        </ResultBlock>
      )}
    </div>
  );
}
