import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiMode, AiProvider, AiScope } from '../../../core/types/ai';
import type { Extraction } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { useAiKeyPresence } from '../../../ui/hooks/useAiRun';
import { useSettings } from '../../../ui/hooks/useSettings';
import { fileChecklist, filesParam, isLimitError, isSetupError, selectedChars } from '../../../ui/review/ai-view';

const PROVIDER_IDS: AiProvider[] = ['gemini', 'claude', 'openai'];
const MODE_LABEL: Record<AiMode, string> = { api: 'API', manual: '반자동' };

export interface AiDialogPreset { scope?: AiScope; provider?: AiProvider; /** 이번만 바꾸기를 펼친 채로 연다 */ expandSwitch?: boolean }

/** [AI로 다시 찾기] 실행 설정: 범위, 공급자·방식(이번만 바꾸기), 파일 체크리스트. */
export function AiRunDialog({ noticeId, extraction, pendingCount, preset, onClose, onStarted }: {
  noticeId: string;
  extraction: Extraction;
  pendingCount: number;
  preset?: AiDialogPreset;
  onClose: () => void;
  /** 실행(API) 또는 요청문 준비(반자동)가 시작됨. 호출자가 run 목록을 다시 읽는다 */
  onStarted: () => void;
}) {
  const { settings } = useSettings();
  const keys = useAiKeyPresence();
  const [scope, setScope] = useState<AiScope>(preset?.scope ?? (pendingCount > 0 ? 'pending' : 'all'));
  const [override, setOverride] = useState<{ provider: AiProvider; mode: AiMode } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(!!preset?.expandSwitch);
  const rows = useMemo(() => fileChecklist(extraction.files), [extraction.files]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((r) => r.selectable).map((r) => r.textPath!)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const base = { provider: preset?.provider ?? settings?.ai.provider ?? 'gemini', mode: settings?.ai.mode ?? 'api' } as { provider: AiProvider; mode: AiMode };
  const cur = override ?? base;
  const adapter = PROVIDERS[cur.provider];
  const apiBlock = (p: AiProvider): string | null => {
    if (!keys || !settings) return null;
    if (!keys[p]) return 'API 키가 없습니다';
    if (!settings.ai.models[p]?.trim()) return '모델이 설정되지 않았습니다';
    return null;
  };

  const chars = selectedChars(extraction.files, selected);
  const overLimit = cur.mode === 'manual' && chars > adapter.manualMaxChars;
  const noneSelected = selected.size === 0;
  const files = filesParam(rows, selected);

  const start = async (mode: AiMode) => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'api') {
        await send('ai/run', { noticeId, scope, provider: cur.provider, ...(files ? { files } : {}) }, { timeoutMs: 70_000 });
      } else {
        // 1단계: 요청문(awaiting run)만 만든다. 복사와 탭 열기는 대기 패널의 [요청문 복사하고 … 열기] 클릭에서 한다(사용자 활성화 만료 방지).
        await send('ai/prepare', { noticeId, scope, provider: cur.provider, ...(files ? { files } : {}) }, { timeoutMs: 35_000 });
      }
      onStarted();
      onClose();
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="AI로 다시 찾기" className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-overlay">
        <div className="space-y-5 overflow-y-auto p-6">
          <h2 className="text-base font-semibold text-ink">AI로 다시 찾기</h2>

          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-semibold">범위</legend>
            <label className={`flex items-center gap-2 ${pendingCount === 0 ? 'text-faint' : ''}`}>
              <input type="radio" name="ai-scope" className="accent-current" disabled={pendingCount === 0} checked={scope === 'pending'} onChange={() => setScope('pending')} />
              확인 필요 항목만 ({pendingCount}개)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="ai-scope" className="accent-current" checked={scope === 'all'} onChange={() => setScope('all')} />
              7개 항목 전체 재검토
            </label>
          </fieldset>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span>공급자·방식: <b>{adapter.label} {MODE_LABEL[cur.mode]}</b> <span className="text-muted">({override ? '이번만' : '설정값'})</span></span>
              <Button variant="ghost" onClick={() => setSwitchOpen(!switchOpen)}>이번만 바꾸기</Button>
            </div>
            {switchOpen && (
              <div className="space-y-3 rounded-ctl border border-line bg-sunken p-4">
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {PROVIDER_IDS.map((p) => (
                    <label key={p} className="flex items-center gap-2">
                      <input type="radio" name="ai-provider" className="accent-current" checked={cur.provider === p} onChange={() => setOverride({ provider: p, mode: cur.mode })} />
                      {PROVIDERS[p].label}
                    </label>
                  ))}
                </div>
                <div className="space-y-1">
                  {(['api', 'manual'] as AiMode[]).map((m) => {
                    const why = m === 'api' ? apiBlock(cur.provider) : null;
                    return (
                      <label key={m} className={`flex items-center gap-2 ${why ? 'text-faint' : ''}`}>
                        <input type="radio" name="ai-mode" className="accent-current" disabled={!!why} checked={cur.mode === m} onChange={() => setOverride({ provider: cur.provider, mode: m })} />
                        {MODE_LABEL[m]}{why && <span className="text-xs">({why})</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <fieldset className="space-y-1.5 text-sm">
            <legend className="mb-1 font-semibold">분석에 쓸 파일</legend>
            {rows.length === 0 && <p className="text-muted">분석된 파일이 없습니다.</p>}
            {rows.map((r, i) => (
              <label key={r.textPath ?? i} className={`flex items-start gap-2 ${r.selectable ? '' : 'text-faint'}`}>
                <input type="checkbox" className="mt-1 accent-current" disabled={!r.selectable} checked={r.selectable && selected.has(r.textPath!)} onChange={() => r.textPath && toggle(r.textPath)} />
                <span className="min-w-0 break-all">{r.name} <span className="text-muted">({r.kindLabel})</span>{r.remark && <span className="block text-xs">{r.remark}</span>}</span>
              </label>
            ))}
          </fieldset>

          {overLimit && (
            <InlineAlert tone="warn">선택한 파일이 길어 일부는 잘릴 수 있습니다(반자동 상한 {adapter.manualMaxChars.toLocaleString('en-US')}자). 파일을 나눠 여러 번 실행하세요.</InlineAlert>
          )}
          {cur.mode === 'manual' && <p className="text-xs text-muted">요청문을 만든 뒤, 다음 화면의 버튼으로 복사하고 {adapter.label} 웹 사이트({adapter.webUrl})를 새 탭으로 엽니다. 붙여넣은 뒤 답을 복사해 여기로 가져오세요.</p>}

          {error && (
            <InlineAlert tone="error">
              <div className="space-y-2">
                <p>{error.code === 'NOTHING_TO_REVIEW' ? '확인이 필요한 항목이 없습니다. 7개 항목 전체로 실행하세요.'
                  : error.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다'
                  : error.code === 'AI_RUN_BUSY' ? '이 공고는 이미 AI 실행 중입니다'
                  : `${error.code ?? ''} ${error.message}`.trim()}</p>
                {(isSetupError(error.code) || isLimitError(error.code)) && (
                  <div className="flex flex-wrap gap-2">
                    {isSetupError(error.code) && <Button variant="secondary" onClick={() => void send('ui/open', { page: 'settings', section: 'ai' })}>설정 열기</Button>}
                    {cur.mode === 'api' && <Button variant="secondary" disabled={busy || noneSelected} onClick={() => void start('manual')}>이번만 반자동으로 실행</Button>}
                  </div>
                )}
              </div>
            </InlineAlert>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          <Button loading={busy} disabled={noneSelected || (scope === 'pending' && pendingCount === 0)} onClick={() => void start(cur.mode)}>
            {cur.mode === 'api' ? '실행' : '요청문 만들기'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
