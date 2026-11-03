import { ArrowRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { estimateRows } from '../../../core/estimate/estimate';
import type { EstimateFile, EstimateKey } from '../../../core/types/estimate';
import type { Extraction } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import { send } from '../../../messaging/bus';
import { Card, inputClass, StatusBadge } from '../../../ui/components';
import { useSettings } from '../../../ui/hooks/useSettings';
import { maxText, overMaxText, parseScoreInput, scoreInputText, totalBadge } from '../../../ui/notice-detail/estimate-view';

const TITLE = '예상 정량 점수';
const DESCRIPTION = '정량평가 배점(추출값)에 우리 점수를 직접 적어 합계를 봅니다. 점수는 공고 문서의 등급표와 대조해 적으세요.';
const NO_COMPANY = { bizNo: '' };

export function EstimateCard({ notice, extraction }: { notice: Notice; extraction: Extraction | null }) {
  const { settings } = useSettings();
  // undefined=불러오는 중, null=파일 없음
  const [file, setFile] = useState<EstimateFile | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<EstimateKey, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<EstimateKey, string>>>({});
  const [open, setOpen] = useState<Partial<Record<EstimateKey, boolean>>>({});
  const sent = useRef<Partial<Record<EstimateKey, string>>>({});

  useEffect(() => {
    let alive = true;
    send('estimate/get', { noticeId: notice.id }).then(
      (f) => { if (alive) setFile(f); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [notice.id]);

  const summary = useMemo(
    () => estimateRows(notice, extraction, file ?? null, settings?.company ?? NO_COMPANY),
    [notice, extraction, file, settings?.company],
  );

  if (failed) {
    return <Card title={TITLE} description={DESCRIPTION}><p className="text-sm text-muted">예상 점수를 읽지 못했습니다</p></Card>;
  }
  if (file === undefined) return <Card title={TITLE} description={DESCRIPTION} />;

  const setError = (key: EstimateKey, msg: string | null) =>
    setErrors((e) => { const n = { ...e }; if (msg) n[key] = msg; else delete n[key]; return n; });

  const commit = async (key: EstimateKey, max: number | null, saved: number | null) => {
    const draft = drafts[key];
    if (draft === undefined) return;
    // Enter 직후 blur로 같은 값이 다시 저장되지 않게 전송 중·직전 전송값을 기억한다.
    if (sent.current[key] === draft) return;
    const parsed = parseScoreInput(draft);
    if (parsed === undefined) { setError(key, '숫자를 입력하세요'); return; }
    if (parsed === saved) {
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      setError(key, null);
      return;
    }
    sent.current[key] = draft;
    try {
      const next = await send('estimate/save', { noticeId: notice.id, key, score: parsed, max });
      setFile(next);
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      setError(key, null);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : '저장하지 못했습니다');
    } finally {
      delete sent.current[key];
    }
  };

  const badges = totalBadge(summary);

  return (
    <Card
      title={TITLE}
      description={DESCRIPTION}
      action={<div className="flex items-center gap-3">{badges.map((b) => <StatusBadge key={b.text} status={b.status}>{b.text}</StatusBadge>)}</div>}
    >
      <table className="w-full table-fixed text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-1 font-medium">항목</th>
            <th className="py-1 font-medium">배점</th>
            <th className="py-1 font-medium">우리 점수</th>
            <th className="py-1 font-medium">참고</th>
            <th className="py-1 font-medium">근거</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((r) => {
            const applicable = r.maxState !== 'not_applicable';
            // 확정(known) 배점만 서버 검증에 넘긴다. 미확정 배점은 입력을 막지 않고 overMax 경고로만 알린다.
            const saveMax = r.maxState === 'known' ? r.max : null;
            const id = `estimate-${r.key}`;
            const error = errors[r.key];
            const showEvidence = open[r.key] && r.evidence;
            return (
              <Fragment key={r.key}>
                <tr className="border-t border-line align-top">
                  <td className="py-1 pr-2 text-ink">{r.label}</td>
                  <td className={`py-1 pr-2 font-mono tabular-nums ${r.maxState === 'review' ? 'text-warn' : ''}`}>{maxText(r)}</td>
                  <td className="py-1 pr-2">
                    {applicable && (
                      <input
                        id={id}
                        aria-label={`${r.label} 우리 점수`}
                        className={`${inputClass} font-mono tabular-nums`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={drafts[r.key] ?? scoreInputText(r.score)}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                        onBlur={() => void commit(r.key, saveMax, r.score)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void commit(r.key, saveMax, r.score); }}
                      />
                    )}
                  </td>
                  <td className="py-1 pr-2 text-muted">
                    {r.hint ?? (r.key === 'management'
                      ? <a className="text-primary underline" href="#/settings?section=company">설정에서 등급 입력</a>
                      : '—')}
                  </td>
                  <td className="py-1">
                    {r.evidence ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:underline"
                        aria-expanded={!!open[r.key]}
                        onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}
                      >
                        {open[r.key] ? '근거 접기' : '근거 보기'}
                      </button>
                    ) : <span className="text-muted">—</span>}
                  </td>
                </tr>
                {(error || (r.overMax && applicable) || showEvidence) && (
                  <tr>
                    <td colSpan={5} className="space-y-1 pb-2 text-sm">
                      {error && <p className="text-danger">{error}</p>}
                      {!error && r.overMax && <p className="text-danger">{overMaxText(r.max)}</p>}
                      {showEvidence && r.evidence && (
                        <blockquote className="rounded-md border-l-2 border-line-strong bg-sunken px-3 py-2 leading-6 text-muted">
                          <span className="block text-xs text-faint">{r.evidence.file} · {r.evidence.location}</span>
                          {r.evidence.text}
                        </blockquote>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end border-t border-line pt-4">
        <a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={`#/notices/${notice.id}/review`}>
          배점 출처: 공고정보 검토 탭
          <ArrowRight className="size-3.5" aria-hidden />
        </a>
      </div>
    </Card>
  );
}
