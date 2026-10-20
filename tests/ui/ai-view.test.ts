import { describe, expect, it } from 'vitest';
import type { AiReviewFile, AiRun, AiSuggestion } from '../../src/core/types/ai';
import type { ExtractedItem, Extraction, ExtractionFile } from '../../src/core/types/extraction';
import {
  REJECT_LABEL, VERDICT_LABEL, afterCopy, buildAiCards, copyOpenButton, terminalSignal, fileChecklist, filesParam, isStale, latestRun, olderCardCount, runSummary, selectedChars, suggestionActions,
} from '../../src/ui/review/ai-view';
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
    expect(Object.keys(VERDICT_LABEL).sort()).toEqual(['differs', 'match', 'new', 'none']);
    expect(VERDICT_LABEL.match).toBe('AI 확인 일치');
    expect(REJECT_LABEL.quote_too_short).toBeTruthy();
    for (const r of ['quote_missing', 'quote_not_found', 'bad_format', 'unknown_key', 'file_not_found'] as const) expect(REJECT_LABEL[r]).toBeTruthy();
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
    expect(copyOpenButton('loading', 'Gemini')).toMatchObject({ label: '요청문 복사하고 Gemini 열기', disabled: true });
    expect(copyOpenButton('error', 'Gemini')).toMatchObject({ disabled: true });
    expect(copyOpenButton('error', 'Gemini').hint).toBeTruthy();
    expect(copyOpenButton('ready', 'Claude')).toEqual({ label: '요청문 복사하고 Claude 열기', disabled: false });
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
