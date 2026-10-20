import { describe, expect, it } from 'vitest';
import type { AiReviewFile, AiRun, AiRunState, AiSuggestion } from '../../src/core/types/ai';
import type { ExtractedItem, Extraction, ExtractionFile, ExtractionKey } from '../../src/core/types/extraction';
import {
  AGREEMENT_LABEL, REJECT_LABEL, VERDICT_LABEL, aiAgreement, aiOthers, buildAiCardsByProvider, compareAgreementSummary, compareRows, afterCopy, buildAiCards, copyOpenButton, terminalSignal, fileChecklist, filesParam, isStale, latestRun, olderCardCount, quickView, runSummary, scopeLabel, selectedChars, suggestionActions,
} from '../../src/ui/review/ai-view';
import { AI_KEYS, isDocAiKey } from '../../src/core/ai/keys';
import { buildCard, buildCards, userEditedBadgeText } from '../../src/ui/review/view';

const sug = (over: Partial<AiSuggestion> & Pick<AiSuggestion, 'key'>): AiSuggestion => ({
  value: 10, quote: '근거 문장 입니다', verdict: 'new', baseline: null, valueInQuote: true, ...over,
});
const run = (id: string, suggestions: AiRun['suggestions'], over: Partial<AiRun> = {}): AiRun => ({
  id, createdAt: '2026-10-20T00:00:00Z', provider: 'gemini', mode: 'api', model: 'm', promptVersion: '1.0.0', scope: 'all', keys: [],
  extractionJobId: 'job-1', extractedAt: 't', status: 'done', files: [], skipped: [], excerptChars: 0, truncated: false,
  warnings: [], suggestions, rejected: [], promptPath: `p/${id}`, ...over,
});
const file = (runs: AiRun[]): AiReviewFile => ({ schemaVersion: 1, noticeId: 'N', runs });
const ex = { jobId: 'job-1' };

describe('buildAiCards', () => {
  it('키별로 가장 최근의 non-stale done run의 제안을 병합한다', () => {
    const newer = run('r2', { credibilityScore: sug({ key: 'credibilityScore', value: 20 }) });
    const older = run('r1', { credibilityScore: sug({ key: 'credibilityScore', value: 5 }), managementScore: sug({ key: 'managementScore', value: 7 }) });
    const cards = buildAiCards(file([newer, older]), ex);
    expect(cards.credibilityScore!.run.id).toBe('r2');
    expect(cards.managementScore!.run.id).toBe('r1');
    expect(Object.keys(cards).sort()).toEqual(['credibilityScore', 'managementScore']);
    expect(olderCardCount(cards, latestRun(file([newer, older])))).toBe(1);
  });

  it('stale·failed·awaiting run은 제외한다', () => {
    const stale = run('r3', { credibilityScore: sug({ key: 'credibilityScore' }) }, { extractionJobId: 'old-job' });
    const failed = run('r2', { managementScore: sug({ key: 'managementScore' }) }, { status: 'failed' });
    const awaiting = run('r1', { performanceScore: sug({ key: 'performanceScore' }) }, { status: 'awaiting' });
    expect(buildAiCards(file([stale, failed, awaiting]), ex)).toEqual({});
    expect(isStale(stale, ex)).toBe(true);
    expect(isStale(failed, ex)).toBe(false);
  });

  it('dismissed 제안은 제외하고, 더 오래된 run의 제안으로 되돌아가지 않는다', () => {
    const newer = run('r2', { credibilityScore: sug({ key: 'credibilityScore', dismissedAt: 't' }) });
    const older = run('r1', { credibilityScore: sug({ key: 'credibilityScore' }), managementScore: sug({ key: 'managementScore' }) });
    const cards = buildAiCards(file([newer, older]), ex);
    expect(cards.credibilityScore).toBeUndefined();
    expect(cards.managementScore!.run.id).toBe('r1');
  });

  it('review가 없으면 빈 객체, latestRun은 첫 run', () => {
    expect(buildAiCards(null, ex)).toEqual({});
    expect(buildAiCards(undefined, ex)).toEqual({});
    expect(latestRun(null)).toBeNull();
    expect(latestRun(file([run('a', {}), run('b', {})]))!.id).toBe('a');
  });
});

describe('runSummary', () => {
  it('일치/제안(differs+new)/못 찾음/검증 실패를 센다', () => {
    const r = run('r', {
      credibilityScore: sug({ key: 'credibilityScore', verdict: 'match' }),
      managementScore: sug({ key: 'managementScore', verdict: 'differs' }),
      performanceScore: sug({ key: 'performanceScore', verdict: 'new' }),
      performancePeriod: sug({ key: 'performancePeriod', verdict: 'none', value: null }),
    }, { rejected: [{ key: 'performanceCondition', reason: 'quote_not_found' }, { key: 'differentialScoring', reason: 'quote_too_short' }] });
    expect(runSummary(r)).toEqual({ match: 1, proposals: 2, none: 1, rejected: 2 });
  });

  it('라벨: verdict 4종과 거부 사유(quote_too_short 포함)', () => {
    expect(Object.keys(VERDICT_LABEL).sort()).toEqual(['differs', 'match', 'multi', 'new', 'none']);
    expect(VERDICT_LABEL.match).toBe('AI 확인 일치');
    expect(REJECT_LABEL.quote_too_short).toBeTruthy();
    for (const r of ['quote_missing', 'quote_not_found', 'bad_format', 'unknown_key', 'file_not_found'] as const) expect(REJECT_LABEL[r]).toBeTruthy();
  });
});

describe('runSummary multi', () => {
  it('multi는 proposals와 별도로 집계한다', () => {
    const r = run('r', { credibilityScore: sug({ key: 'credibilityScore', verdict: 'multi', value: null }), managementScore: sug({ key: 'managementScore' }) });
    expect(runSummary(r)).toEqual({ match: 0, proposals: 1, none: 0, rejected: 0, multi: 1 });
  });
});

describe('suggestionActions', () => {
  const open = { badge: 'needs_review' as const, userEdited: false };
  it('differs/new → 적용·무시', () => {
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'differs' }))).toEqual(['apply', 'dismiss']);
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'new' }))).toEqual(['apply', 'dismiss']);
  });
  it('match: verified가 아니면 확정, verified면 버튼 없음', () => {
    const m = sug({ key: 'credibilityScore', verdict: 'match' });
    expect(suggestionActions(open, m)).toEqual(['confirm']);
    expect(suggestionActions({ badge: 'verified', userEdited: false }, m)).toEqual([]);
  });
  it('multi: value null이어도 variants가 있으면 적용 가능, 없으면 무시만', () => {
    const v = { condition: 'A', value: 10, quote: 'q', valueInQuote: true };
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'multi', value: null, variants: [v] }))).toEqual(['apply', 'dismiss']);
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'multi', value: null }))).toEqual(['dismiss']);
  });
  it('none → 무시만, 적용 후 사용자 수정이면 버튼 없음', () => {
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'none', value: null }))).toEqual(['dismiss']);
    expect(suggestionActions({ badge: 'userEdited', userEdited: true }, sug({ key: 'credibilityScore', appliedAt: 't' }))).toEqual([]);
    // 적용했지만 되돌려 수정이 없으면 다시 적용 가능
    expect(suggestionActions(open, sug({ key: 'credibilityScore', verdict: 'differs', appliedAt: 't' }))).toEqual(['apply', 'dismiss']);
  });
});

describe('origin 배지와 카드 주입', () => {
  const item = (over: Partial<ExtractedItem<unknown>>): ExtractedItem<unknown> => ({ value: 3, status: 'needs_review', ...over });
  it('userEdited.origin이 ai면 editedOrigin과 "AI 제안 적용" 배지', () => {
    const c = buildCard('credibilityScore', item({ userEdited: { value: 10, editedAt: 't', origin: { kind: 'ai', runId: 'r', provider: 'gemini', model: 'm', promptVersion: '1.0.0' } } }));
    expect(c.badge).toBe('userEdited');
    expect(c.editedOrigin).toBe('ai');
    expect(userEditedBadgeText(c)).toBe('AI 제안 적용');
  });
  it('origin이 없으면 기존 "직접 수정"', () => {
    const c = buildCard('credibilityScore', item({ userEdited: { value: 10, editedAt: 't' } }));
    expect(c.editedOrigin).toBeUndefined();
    expect(userEditedBadgeText(c)).toBe('직접 수정');
  });
  it('buildCards는 AI 제안을 해당 카드에만 주입하고 값·상태는 바꾸지 않는다', () => {
    const items = Object.fromEntries(['credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition', 'differentialScoring']
      .map((k) => [k, item({ value: null, reason: 'not_found' })])) as Extraction['items'];
    const x = { items } as Extraction;
    const info = { suggestion: sug({ key: 'managementScore', value: 9 }), run: run('r', {}) };
    const cards = buildCards(x, { managementScore: info });
    expect(cards.find((c) => c.key === 'managementScore')!.ai).toBe(info);
    expect(cards.filter((c) => c.ai)).toHaveLength(1);
    expect(cards.find((c) => c.key === 'managementScore')).toMatchObject({ value: null, badge: 'needs_review' });
    expect(buildCards(x).every((c) => c.ai === undefined)).toBe(true);
  });
});

describe('파일 체크리스트', () => {
  const f = (over: Partial<ExtractionFile>): ExtractionFile => ({ attachmentId: 'a', name: 'x.hwp', docKind: 'rfp', priority: 1, status: 'parsed', textPath: 'p/x.txt', chars: 1000, ...over });
  const files = [
    f({ name: 'a.hwp', textPath: 'p/a.txt', chars: 2000 }),
    f({ name: 'b.pdf', status: 'scanned', textPath: undefined }),
    f({ name: 'c.hwp', status: 'encrypted', textPath: undefined }),
    f({ name: 'dup.pdf', status: 'skipped', skipReason: 'duplicate', textPath: undefined }),
    f({ name: 'd.hwp', textPath: 'p/d.txt', chars: 3000, innerPath: 'in/d.hwp' }),
  ];
  it('분석 완료는 선택 가능, 스캔·암호는 회색 고정+제외 표기, 의도적 건너뜀은 숨긴다', () => {
    const rows = fileChecklist(files);
    expect(rows.map((r) => [r.name, r.selectable])).toEqual([['a.hwp', true], ['b.pdf', false], ['c.hwp', false], ['d.hwp › in/d.hwp', true]]);
    expect(rows[1]!.remark).toContain('AI 재검토 제외');
  });
  it('filesParam: 전부 선택이면 undefined, 일부면 textPath 배열. selectedChars는 선택 합', () => {
    const rows = fileChecklist(files);
    expect(filesParam(rows, new Set(['p/a.txt', 'p/d.txt']))).toBeUndefined();
    expect(filesParam(rows, new Set(['p/a.txt']))).toEqual(['p/a.txt']);
    expect(selectedChars(files, new Set(['p/a.txt', 'p/d.txt']))).toBe(5000);
    expect(selectedChars(files, new Set(['p/d.txt']))).toBe(3000);
  });
});

describe('반자동 대기 패널 주 버튼', () => {
  it('요청문을 받기 전·실패 시 비활성, 받은 뒤 활성(라벨에 공급자)', () => {
    expect(copyOpenButton('loading', 'Gemini')).toMatchObject({ label: '프롬프트 복사하고 Gemini 열기', disabled: true });
    expect(copyOpenButton('error', 'Gemini')).toMatchObject({ disabled: true });
    expect(copyOpenButton('error', 'Gemini').hint).toBeTruthy();
    expect(copyOpenButton('ready', 'Claude')).toEqual({ label: '프롬프트 복사하고 Claude 열기', disabled: false });
  });
  it('복사에 성공해야 탭을 연다, 실패하면 열지 않고 다시 누르라고 안내', () => {
    expect(afterCopy(true)).toMatchObject({ openTab: true, message: { tone: 'info' } });
    expect(afterCopy(false)).toEqual({ openTab: false, message: { tone: 'error', text: '복사 실패, 다시 눌러 주세요' } });
  });
});

describe('terminalSignal', () => {
  it('끝난 상태만 서명을 돌려주고, 진행 중·없음은 null', () => {
    const s = (status: string) => ({ runId: 'r1', status, at: 't1' });
    expect(terminalSignal(s('done'))).toBe('r1:done:t1');
    expect(terminalSignal(s('failed'))).toBe('r1:failed:t1');
    expect(terminalSignal(s('cancelled'))).toBe('r1:cancelled:t1');
    for (const st of ['preparing', 'requesting', 'verifying']) expect(terminalSignal(s(st))).toBeNull();
    expect(terminalSignal(null)).toBeNull();
  });
});

describe('D2: 요청 여부(run.keys) 기준 buildAiCards', () => {
  const req = (id: string, keys: ExtractionKey[], suggestions: AiRun['suggestions'], over: Partial<AiRun> = {}) => run(id, suggestions, { keys, ...over });
  it('최신 run이 요청했는데 제안이 없으면(검증 실패) 오래된 run으로 폴백하지 않고 빈칸', () => {
    const older = req('r1', ['credibilityScore'], { credibilityScore: sug({ key: 'credibilityScore' }) });
    const newer = req('r2', ['credibilityScore'], {}, { rejected: [{ key: 'credibilityScore', reason: 'quote_not_found' }] });
    expect(buildAiCards(file([newer, older]), ex).credibilityScore).toBeUndefined();
  });
  it('최신 run이 요청하지 않은 키는 오래된 run의 제안을 쓴다', () => {
    const older = req('r1', ['credibilityScore', 'managementScore'], { credibilityScore: sug({ key: 'credibilityScore' }), managementScore: sug({ key: 'managementScore' }) });
    const newer = req('r2', ['managementScore'], { managementScore: sug({ key: 'managementScore', value: 3 }) });
    const cards = buildAiCards(file([newer, older]), ex);
    expect(cards.managementScore!.run.id).toBe('r2');
    expect(cards.credibilityScore!.run.id).toBe('r1');
  });
  it('keys가 빈 옛 run은 제안이 있는 키만 요청한 것으로 본다(방어)', () => {
    const legacy = req('r0', [], { performanceScore: sug({ key: 'performanceScore' }) });
    expect(Object.keys(buildAiCards(file([legacy]), ex))).toEqual(['performanceScore']);
  });
  it('요청했지만 무시된 제안도 오래된 run으로 폴백하지 않는다', () => {
    const older = req('r1', ['credibilityScore'], { credibilityScore: sug({ key: 'credibilityScore' }) });
    const newer = req('r2', ['credibilityScore'], { credibilityScore: sug({ key: 'credibilityScore', dismissedAt: 't' }) });
    expect(buildAiCards(file([newer, older]), ex).credibilityScore).toBeUndefined();
  });
});

describe('scopeLabel', () => {
  it('pending / all / keys 라벨', () => {
    expect(scopeLabel({ scope: 'pending', keys: ['credibilityScore'] })).toBe('확인 필요 항목');
    expect(scopeLabel({ scope: 'all', keys: [...AI_KEYS] })).toBe('16개 전체');
    expect(scopeLabel({ scope: 'all', keys: AI_KEYS.filter((k) => isDocAiKey(k)) })).toBe('7개 전체'); // 옛 run
    expect(scopeLabel({ scope: 'keys', keys: ['credibilityScore', 'performancePeriod'] })).toBe('항목: 대외신인도 배점, 실적 인정기간');
  });
});

describe('quickView', () => {
  const st = (status: AiRunState['status'], runId = 'r1', label = '요청 중') => ({ noticeId: 'N', runId, provider: 'gemini' as const, status, label, at: 't' });
  it('run 없음·cancelled·stale done은 idle', () => {
    expect(quickView(null, ex, null).phase).toBe('idle');
    expect(quickView(file([run('r1', {}, { status: 'cancelled' })]), ex, null).phase).toBe('idle');
    expect(quickView(file([run('r1', {}, { extractionJobId: 'old' })]), ex, null).phase).toBe('idle');
  });
  it('requesting은 running(세션 라벨 우선), awaiting은 awaiting', () => {
    expect(quickView(file([run('r1', {}, { status: 'requesting' })]), ex, st('requesting', 'r1', '근거 확인 중'))).toMatchObject({ phase: 'running', label: '근거 확인 중' });
    expect(quickView(file([run('r1', {}, { status: 'requesting' })]), ex, st('requesting', 'other'))).toMatchObject({ phase: 'running', label: 'AI에 요청하는 중' });
    expect(quickView(file([run('r1', {}, { status: 'awaiting' })]), ex, null).phase).toBe('awaiting');
  });
  it('failed는 error를 담고, done은 요약 라벨', () => {
    const f = quickView(file([run('r1', {}, { status: 'failed', error: { code: 'AI_QUOTA', message: 'q' } })]), ex, null);
    expect(f).toMatchObject({ phase: 'failed', error: { code: 'AI_QUOTA' } });
    const d = quickView(file([run('r1', {
      credibilityScore: sug({ key: 'credibilityScore', verdict: 'match' }), managementScore: sug({ key: 'managementScore', verdict: 'new' }),
    }, { rejected: [{ key: 'x', reason: 'bad_format' }] })]), ex, null);
    expect(d).toMatchObject({ phase: 'done', label: 'AI 제안 1 · 일치 1 · 못 찾음 0 · 검증 실패 1', summary: { match: 1, proposals: 1, none: 0, rejected: 1 } });
  });

  it('세션이 진행 상태이고 run이 없거나 runId가 다르면 running', () => {
    const st = (status: AiRunState['status'], runId: string, label = ''): AiRunState => ({ noticeId: 'n', runId, provider: 'gemini', status, label, at: '2026-01-01T00:00:00Z' });
    expect(quickView(null, ex, st('preparing', 'r9', '프롬프트 만드는 중'))).toEqual({ phase: 'running', label: '프롬프트 만드는 중' });
    expect(quickView(null, ex, st('preparing', 'r9')).label).toBe('준비 중');
    const prev = { schemaVersion: 1, noticeId: 'n', runs: [run('old', {})] } as AiReviewFile;
    expect(quickView(prev, ex, st('verifying', 'r9', '검증 중')).phase).toBe('running');
    // 종료 상태는 기존 로직 유지
    expect(quickView(null, ex, st('done', 'r9')).phase).toBe('idle');
  });
});


describe('비교 표시 순수 함수', () => {
  const K = 'credibilityScore' as const;
  const gem = (id: string, s: AiRun['suggestions'], over: Partial<AiRun> = {}) => run(id, s, { provider: 'gemini', keys: [K], ...over });
  const cla = (id: string, s: AiRun['suggestions'], over: Partial<AiRun> = {}) => run(id, s, { provider: 'claude', keys: [K], ...over });
  const info = (s: Partial<AiSuggestion>, id = 'x') => ({ suggestion: sug({ key: K, ...s }), run: run(id, {}) });

  it('Gemini 뒤 Claude 실행: primary=Claude, others=[Gemini]', () => {
    const f = file([cla('c1', { [K]: sug({ key: K }) }), gem('g1', { [K]: sug({ key: K, value: 3 }) })]);
    const primary = buildAiCards(f, ex);
    const others = aiOthers(primary, buildAiCardsByProvider(f, ex));
    expect(primary[K]!.run.id).toBe('c1');
    expect(others[K]!.map((i) => i.run.id)).toEqual(['g1']);
  });

  it('Claude가 키를 요청했지만 제안 없음: primary 없음, others=[Gemini]', () => {
    const f = file([cla('c1', {}), gem('g1', { [K]: sug({ key: K }) })]);
    const primary = buildAiCards(f, ex);
    expect(primary[K]).toBeUndefined();
    expect(aiOthers(primary, buildAiCardsByProvider(f, ex))[K]!.map((i) => i.run.id)).toEqual(['g1']);
  });

  it('dismissed 제안은 others에서 제외', () => {
    const f = file([cla('c1', { [K]: sug({ key: K }) }), gem('g1', { [K]: sug({ key: K, dismissedAt: 't' }) })]);
    expect(aiOthers(buildAiCards(f, ex), buildAiCardsByProvider(f, ex))).toEqual({});
  });

  it('stale run은 others에서 제외', () => {
    const f = file([cla('c1', { [K]: sug({ key: K }) }), gem('g1', { [K]: sug({ key: K }) }, { extractionJobId: 'old' })]);
    expect(aiOthers(buildAiCards(f, ex), buildAiCardsByProvider(f, ex))).toEqual({});
  });

  it('같은 공급자 run이 2개면 최신만', () => {
    const f = file([cla('c1', { [K]: sug({ key: K }) }), gem('g2', { [K]: sug({ key: K }) }), gem('g1', { [K]: sug({ key: K }) })]);
    expect(aiOthers(buildAiCards(f, ex), buildAiCardsByProvider(f, ex))[K]!.map((i) => i.run.id)).toEqual(['g2']);
  });

  it('others 순서는 AI_PROVIDERS 순', () => {
    const o = run('o1', { [K]: sug({ key: K }) }, { provider: 'openai', keys: [K] });
    const f = file([cla('c1', { [K]: sug({ key: K }) }), o, gem('g1', { [K]: sug({ key: K }) })].reverse().reverse());
    const primary = buildAiCards(f, ex);
    expect(primary[K]!.run.id).toBe('c1');
    expect(aiOthers(primary, buildAiCardsByProvider(f, ex))[K]!.map((i) => i.run.provider)).toEqual(['gemini', 'openai']);
  });

  it('aiAgreement', () => {
    expect(aiAgreement([info({ value: 3 }), info({ value: 3 })])).toEqual({ n: 2, verdict: 'agree' });
    expect(aiAgreement([info({ value: '3년' }), info({ value: '3 년' })])!.verdict).toBe('agree');
    expect(aiAgreement([info({ value: 3 }), info({ value: 4 })])!.verdict).toBe('differ');
    expect(aiAgreement([info({ value: 3 }), info({ value: null, verdict: 'none' })])!.verdict).toBe('partial');
    expect(aiAgreement([info({ value: null, verdict: 'none' }), info({ value: null, verdict: 'none' })])!.verdict).toBe('agree_none');
    const v = (n: number) => ({ condition: 'c', value: n, quote: 'q', valueInQuote: true });
    const m = (vs: number[]) => info({ value: null, verdict: 'multi', variants: vs.map(v) });
    expect(aiAgreement([m([1, 2]), m([2, 1])])!.verdict).toBe('agree');
    expect(aiAgreement([info({})])).toBeNull();
    expect(AGREEMENT_LABEL.agree(3)).toBe('AI 3개 일치');
    expect(compareAgreementSummary({ [K]: info({ value: 3 }) }, { [K]: [info({ value: 4 })] })).toEqual({ compared: 1, agree: 0, differ: 1, partial: 0, none: 0 });
  });

  it('compareRows', () => {
    const base = { compareId: 'cmp' };
    const f = file([gem('g1', {}, { ...base, status: 'requesting', createdAt: '2026-10-20T00:00:01Z' })]);
    const state = (index: number): AiRunState => ({ noticeId: 'N', runId: 'g1', provider: 'gemini', status: 'requesting', label: 'x', at: 't', compare: { id: 'cmp', providers: ['gemini', 'claude', 'openai'], index } });
    const live = compareRows(f, state(0))!;
    expect(live.rows.map((r) => [r.provider, r.status])).toEqual([['gemini', 'running'], ['claude', 'queued'], ['openai', 'queued']]);
    expect(compareRows(f, null)!.rows.map((r) => r.status)).toEqual(['running']);
    const f2 = file([gem('g1', {}, { ...base, createdAt: '2026-10-20T00:00:01Z' }), cla('c1', {}, { ...base, createdAt: '2026-10-20T00:00:02Z' })]);
    const [g, c] = f2.runs as [AiRun, AiRun];
    const rows = compareRows({ ...f2, runs: [c, g] }, state(2))!;
    expect(rows.rows.map((r) => [r.provider, r.status])).toEqual([['gemini', 'done'], ['claude', 'done'], ['openai', 'missing']]);
    expect(rows.scopeRun.id).toBe('g1');
    expect(compareRows(file([gem('g1', {})]), null)).toBeNull();
    // 1번째에서 취소되어 종료 상태가 남으면 남은 공급자는 대기가 아니라 missing
    const cancelled = file([gem('g1', {}, { ...base, status: 'cancelled', createdAt: '2026-10-20T00:00:01Z' })]);
    const ended: AiRunState = { ...state(0), status: 'cancelled' };
    expect(compareRows(cancelled, ended)!.rows.map((r) => r.status)).toEqual(['cancelled', 'missing', 'missing']);
  });

  it('quickView compare 라벨', () => {
    const s: AiRunState = { noticeId: 'N', runId: 'r9', provider: 'claude', status: 'requesting', label: '요청 중', at: 't', compare: { id: 'c', providers: ['gemini', 'claude'], index: 1 } };
    expect(quickView(null, ex, s).label).toBe('AI 비교 2/2 · 요청 중');
  });
});
