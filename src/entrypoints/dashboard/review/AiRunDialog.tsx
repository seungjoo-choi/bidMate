import { FileText, Settings, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AI_PROVIDERS, type AiMode, type AiProvider, type AiScope } from '../../../core/types/ai';
import type { AiKey } from '../../../core/ai/keys';
import type { Extraction } from '../../../core/types/extraction';
import { PROVIDERS } from '../../../engine/ai/providers';
import { send } from '../../../messaging/bus';
import { Button, FormActions, InlineAlert, ProviderIcon } from '../../../ui/components';
import { useAiKeyPresence } from '../../../ui/hooks/useAiRun';
import { useSettings } from '../../../ui/hooks/useSettings';
import { fileChecklist, filesParam, isLimitError, isSetupError, selectedChars } from '../../../ui/review/ai-view';
import { REVIEW_LABEL } from '../../../core/extraction/review-rows';

const MODE_LABEL: Record<AiMode, string> = { api: 'API', manual: '프롬프트 복사' };
/** 이 팝업의 실행 버튼(AI 톤). 공통 Button의 ghost 위에 덮어쓴다. */
const AI_RADIO = 'accent-ai-ink';

export interface AiDialogPreset {
  scope?: AiScope; provider?: AiProvider;
  /** scope가 'keys'일 때 대상 항목. 범위에 "이 항목만: <라벨>"이 세 번째로 고정된다 */
  keys?: AiKey[];
  /** 이번만 바꾸기를 펼친 채로 연다 */ expandSwitch?: boolean;
  /** 여러 AI로 비교 모드로 연다 */ compare?: boolean;
  /** 열자마자 보여 줄 오류(설정 오류 등) */ initialError?: { code?: string; message: string };
}

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
  const [scope, setScope] = useState<AiScope>(() => {
    if (preset?.scope === 'keys' && preset.keys?.length) return 'keys';
    if (preset?.scope === 'pending' || preset?.scope === 'all') return preset.scope;
    return pendingCount > 0 ? 'pending' : 'all';
  });
  const presetKeys = preset?.keys && preset.keys.length > 0 ? preset.keys : null;
  const [override, setOverride] = useState<{ provider: AiProvider; mode: AiMode } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(!!preset?.expandSwitch);
  const rows = useMemo(() => fileChecklist(extraction.files), [extraction.files]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((r) => r.selectable).map((r) => r.textPath!)));
  const [compare, setCompare] = useState(!!preset?.compare);
  // undefined = 아직 손대지 않음(사용 가능한 공급자 전부가 기본). 키 정보가 늦게 와도 기본값이 따라간다
  const [picked, setPicked] = useState<Set<AiProvider> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(preset?.initialError ?? null);

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

  const compareProviders = picked ?? new Set(AI_PROVIDERS.filter((p) => !apiBlock(p)));
  const chosen = AI_PROVIDERS.filter((p) => compareProviders.has(p) && !apiBlock(p));
  const togglePick = (p: AiProvider) => setPicked(() => { const n = new Set(compareProviders); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const chars = selectedChars(extraction.files, selected);
  const overLimit = !compare && cur.mode === 'manual' && chars > adapter.manualMaxChars;
  const noneSelected = selected.size === 0;
  const files = filesParam(rows, selected);

  const start = async (mode: AiMode) => {
    setBusy(true);
    setError(null);
    try {
      if (compare) {
        await send('ai/compare-run', { noticeId, scope, ...(scope === 'keys' && presetKeys ? { keys: presetKeys } : {}), providers: chosen, ...(files ? { files } : {}) }, { timeoutMs: 70_000 });
      } else if (mode === 'api') {
        await send('ai/run', { noticeId, scope, ...(scope === 'keys' && presetKeys ? { keys: presetKeys } : {}), provider: cur.provider, ...(files ? { files } : {}) }, { timeoutMs: 70_000 });
      } else {
        // 1단계: 요청문(awaiting run)만 만든다. 복사와 탭 열기는 대기 패널의 [요청문 복사하고 … 열기] 클릭에서 한다(사용자 활성화 만료 방지).
        await send('ai/prepare', { noticeId, scope, ...(scope === 'keys' && presetKeys ? { keys: presetKeys } : {}), provider: cur.provider, ...(files ? { files } : {}) }, { timeoutMs: 35_000 });
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
      <div role="dialog" aria-modal="true" aria-label="AI로 다시 찾기" data-ai={cur.provider} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-ai-line bg-surface shadow-overlay">
        <div className="ai-tint flex items-start gap-3 border-b border-ai-line bg-ai-wash px-6 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-ai-line bg-surface text-ai-ink"><ProviderIcon provider={cur.provider} size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">AI로 다시 찾기</h2>
            <p className="mt-0.5 text-xs text-ai-ink">AI가 공고 문서를 다시 읽고, 근거와 함께 값을 제안합니다.</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="닫기" className="-mt-1" icon={<X />} onClick={onClose} />
        </div>
        <div className="space-y-5 overflow-y-auto p-6">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-semibold">범위</legend>
            <label className={`flex items-center gap-2 ${pendingCount === 0 ? 'text-faint' : ''}`}>
              <input type="radio" name="ai-scope" className={AI_RADIO} disabled={pendingCount === 0} checked={scope === 'pending'} onChange={() => setScope('pending')} />
              확인 필요 항목만 ({pendingCount}개)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="ai-scope" className={AI_RADIO} checked={scope === 'all'} onChange={() => setScope('all')} />
              13개 항목 전체 재검토
            </label>
            {presetKeys && (
              <label className="flex items-center gap-2">
                <input type="radio" name="ai-scope" className={AI_RADIO} checked={scope === 'keys'} onChange={() => setScope('keys')} />
                이 항목만: {presetKeys.map((k) => REVIEW_LABEL[k] ?? k).join(', ')}
              </label>
            )}
          </fieldset>

          <fieldset className="text-sm">
            <legend className="mb-2 font-semibold">사용할 AI</legend>
            <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1">
              <label className="flex items-center gap-2">
                <input type="radio" name="ai-compare" className={AI_RADIO} checked={!compare} onChange={() => setCompare(false)} />
                AI 하나로 실행
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="ai-compare" className={AI_RADIO} checked={compare} onChange={() => setCompare(true)} />
                여러 AI로 비교
              </label>
            </div>
            {compare ? (
              <div className="space-y-2 rounded-ctl border border-line px-3.5 py-3">
                {AI_PROVIDERS.map((p) => {
                  const why = apiBlock(p);
                  return (
                    <label key={p} data-ai={p} className={`flex items-center gap-2 ${why ? 'text-faint' : ''}`}>
                      <input type="checkbox" className={AI_RADIO} disabled={!!why} checked={!why && compareProviders.has(p)} onChange={() => togglePick(p)} />
                      <ProviderIcon provider={p} size={16} />
                      {PROVIDERS[p].label}{why && <span className="text-xs">({why})</span>}
                    </label>
                  );
                })}
                <p className="text-xs text-muted">비교는 API 방식으로만 실행합니다. 공급자마다 run이 하나씩 만들어집니다.</p>
              </div>
            ) : (
            <div className="overflow-hidden rounded-ctl border border-line">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                <ProviderIcon provider={cur.provider} size={16} />
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{adapter.label}</span>
                  <span className="text-muted"> · {MODE_LABEL[cur.mode]}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-px text-xs ${override ? 'bg-ai-wash text-ai-ink' : 'bg-sunken text-muted'}`}>{override ? '이번만 변경' : '기본 설정'}</span>
                <Button variant="secondary" className="ml-auto !h-8 !px-3 !text-[0.8125rem]" aria-expanded={switchOpen} onClick={() => setSwitchOpen(!switchOpen)}>
                  {switchOpen ? '접기' : '이번만 바꾸기'}
                </Button>
              </div>
              {switchOpen && (
                <div className="grid grid-cols-[3.5rem_1fr] items-start gap-x-3 gap-y-2.5 border-t border-line bg-sunken px-3.5 py-3">
                  <span className="pt-px text-xs text-muted">공급자</span>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {AI_PROVIDERS.map((p) => (
                      <label key={p} className="flex items-center gap-2">
                        <input type="radio" name="ai-provider" className={AI_RADIO} checked={cur.provider === p} onChange={() => setOverride({ provider: p, mode: cur.mode })} />
                        {PROVIDERS[p].label}
                      </label>
                    ))}
                  </div>
                  <span className="pt-px text-xs text-muted">방식</span>
                  <div className="space-y-1">
                    {(['api', 'manual'] as AiMode[]).map((m) => {
                      const why = m === 'api' ? apiBlock(cur.provider) : null;
                      return (
                        <label key={m} className={`flex items-center gap-2 ${why ? 'text-faint' : ''}`}>
                          <input type="radio" name="ai-mode" className={AI_RADIO} disabled={!!why} checked={cur.mode === m} onChange={() => setOverride({ provider: cur.provider, mode: m })} />
                          {MODE_LABEL[m]}{why && <span className="text-xs">({why})</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            )}
          </fieldset>

          <fieldset className="space-y-1.5 text-sm">
            <legend className="mb-1 font-semibold">분석에 쓸 파일</legend>
            {rows.length === 0 && <p className="text-muted">분석된 파일이 없습니다.</p>}
            {rows.map((r, i) => (
              <label key={r.textPath ?? i} className={`flex items-start gap-2 ${r.selectable ? '' : 'text-faint'}`}>
                <input type="checkbox" className={`mt-1 ${AI_RADIO}`} disabled={!r.selectable} checked={r.selectable && selected.has(r.textPath!)} onChange={() => r.textPath && toggle(r.textPath)} />
                <span className="min-w-0 wrap-anywhere">{r.name} <span className="text-muted">({r.kindLabel})</span>{r.remark && <span className="block text-xs">{r.remark}</span>}</span>
              </label>
            ))}
          </fieldset>

          {overLimit && (
            <InlineAlert tone="warn">선택한 파일이 길어 일부는 잘릴 수 있습니다(프롬프트 상한 {adapter.manualMaxChars.toLocaleString('en-US')}자). 파일을 나눠 여러 번 실행하세요.</InlineAlert>
          )}
          {!compare && cur.mode === 'manual' && <p className="text-xs text-muted">프롬프트를 만든 뒤, 다음 화면의 버튼으로 복사하고 {adapter.label} 웹 사이트({adapter.webUrl})를 새 탭으로 엽니다. 붙여넣은 뒤 답을 복사해 여기로 가져오세요.</p>}

          {error && (
            <InlineAlert tone="error">
              <div className="space-y-2">
                <p>{error.code === 'NOTHING_TO_REVIEW' ? '확인이 필요한 항목이 없습니다. 13개 항목 전체로 실행하세요.'
                  : error.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다'
                  : error.code === 'AI_RUN_BUSY' ? '이 공고는 이미 AI 실행 중입니다'
                  : isSetupError(error.code) ? error.message
                  : `${error.code ?? ''} ${error.message}`.trim()}</p>
                {(isSetupError(error.code) || isLimitError(error.code)) && (
                  <div className="flex flex-wrap gap-2">
                    {isSetupError(error.code) && <Button variant="secondary" icon={<Settings />} onClick={() => void send('ui/open', { page: 'settings', section: 'ai' })}>AI 설정 열기</Button>}
                    {!compare && cur.mode === 'api' && (
                      <Button variant="secondary" disabled={busy} icon={<FileText />} title={`이번만 ${adapter.label} 웹 사이트에 프롬프트를 붙여넣는 방식으로 바꿉니다`} onClick={() => { setOverride({ provider: cur.provider, mode: 'manual' }); setError(null); }}>
                        프롬프트 방식으로 바꾸기
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </InlineAlert>
          )}
        </div>
        <div className="border-t border-line px-6 py-4">
          <FormActions>
            <Button variant="secondary" onClick={onClose}>닫기</Button>
            <Button
              variant="ai" loading={busy} icon={cur.mode === 'api' || compare ? <Sparkles /> : <FileText />}
              disabled={noneSelected || (scope === 'pending' && pendingCount === 0) || (compare && chosen.length < 2)}
              {...(compare && chosen.length < 2 ? { title: '두 개 이상 고르세요' } : {})} onClick={() => void start(cur.mode)}
            >
              {compare ? `${chosen.length}개 AI로 비교` : cur.mode === 'api' ? 'AI로 찾기' : '프롬프트 만들기'}
            </Button>
          </FormActions>
        </div>
      </div>
    </div>,
    document.body,
  );
}
