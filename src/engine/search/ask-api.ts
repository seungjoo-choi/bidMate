import { redactKey } from '../../adapters/g2b/openapi';
import { renderLines } from '../../core/ai/excerpt';
import type { DocKind } from '../../core/extraction/classify';
import { DETAIL_KIND_LABEL } from '../../core/model/detail-text';
import { ASK_PROMPT_VERSION, askOutputSchema, buildAskPrompt, parseAskResponse } from '../../core/search/ask-prompt';
import { locateCitations, locateConflicts, type AskVerifyDoc } from '../../core/search/ask-verify';
import { ASK_FULL_MAX_CHARS, ASK_MAX_TOKENS, ASK_QUESTION_MAX_CHARS } from '../../core/search/constants';
import { selectContext, type ContextSegment } from '../../core/search/context';
import type { SearchDoc } from '../../core/search/types';
import { buildUnits } from '../../core/search/units';
import type { AiProvider } from '../../core/types/ai';
import type { AskFile, AskRecord, NoticeTexts } from '../../core/types/search';
import { callProvider } from '../ai/ai-client';
import { PROVIDERS } from '../ai/providers';
import type { IFileStore } from '../file-store/types';
import { readNoticeTexts } from '../notices/notice-api';
import { NoticeStore } from '../notices/notice-store';
import { askPromptPath, askResponsePath, AskStore } from './search-store';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

/** engine은 ui를 import하지 않으므로 `ui/review/view.ts`의 DOC_KIND_LABEL과 같은 값을 여기에 둔다(ai-review-api와 같은 이유). */
const KIND_LABEL: Record<DocKind, string> = {
  eval_criteria: '평가기준', notice: '공고문', rfp: '제안요청서', qna: '질의답변', other: '기타', form: '양식', reference: '참고',
};
const FIELD_DOC_ID = 'fields';
const DETAIL_LABEL = '나라장터 상세화면';

export interface AskInput {
  noticeId: string; askId: string; question: string;
  /** 항목값 가상 문서 텍스트(대시보드가 만들어 보낸다) */
  fieldDocText: string;
  provider: AiProvider; api: { key: string; model: string };
  contextMode: 'context' | 'full';
  fetch: typeof globalThis.fetch; signal?: AbortSignal;
}
export interface AskDeps { now?: () => Date; isBusy?: (noticeId: string) => boolean; retryDelayMs?: number }

/** NoticeTexts와 항목값 문서 텍스트로 검색 문서를 만든다(ui/search/search-view.ts buildSearchDocs와 같은 순서·라벨). */
function buildDocs(texts: NoticeTexts, fieldDocText: string): { docs: SearchDoc[]; verify: AskVerifyDoc[] } {
  const docs: SearchDoc[] = [];
  if (fieldDocText.trim()) {
    docs.push({ id: FIELD_DOC_ID, kind: 'fields', label: '공고정보 항목값', kindLabel: '항목값', priority: -1, lines: fieldDocText.split('\n') });
  }
  // 항목값 문서도 인용 검증 대상이다. 파일이 아니므로 textPath는 빈 문자열(UI는 docId 'fields'로 구분한다).
  const verify: AskVerifyDoc[] = fieldDocText.trim() ? [{ id: FIELD_DOC_ID, name: '공고정보 항목값', textPath: '', text: fieldDocText }] : [];
  const files = texts.files.map((f, i) => ({ f, i })).filter(({ f }) => f.text !== '').sort((a, b) => a.f.priority - b.f.priority || a.i - b.i);
  for (const { f } of files) {
    const lines = f.text.split('\n');
    if (f.kind === 'detail') {
      docs.push({ id: f.id, kind: 'detail', label: DETAIL_LABEL, kindLabel: DETAIL_KIND_LABEL, textPath: f.textPath, priority: f.priority, lines });
      verify.push({ id: f.id, name: DETAIL_LABEL, textPath: f.textPath, text: f.text });
    } else {
      const kind = f.docKind ? KIND_LABEL[f.docKind] ?? f.docKind : '첨부';
      docs.push({ id: f.id, kind: 'attachment', label: f.name, kindLabel: `${f.origin === 'prespec' ? '사전규격 / ' : ''}${kind}`, textPath: f.textPath, priority: f.priority, lines });
      verify.push({ id: f.id, name: f.name, textPath: f.textPath, text: f.text });
    }
  }
  return { docs, verify };
}

const fullSegments = (docs: SearchDoc[]): ContextSegment[] =>
  docs.filter((d) => d.lines.length > 0).map((d) => ({ docId: d.id, from: 0, to: d.lines.length - 1, text: renderLines(d.lines).join('\n') }));

/** 질문 1건 실행. 실패(공급자 오류·답변 형식 오류)는 failed 기록으로 남기고, 취소는 저장 없이 AI_RUN_CLOSED를 던진다. */
export async function askNotice(store: IFileStore, p: AskInput, deps: AskDeps = {}): Promise<AskRecord> {
  const now = deps.now ?? (() => new Date());
  if (deps.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '이 공고는 다른 작업이 진행 중입니다.');
  const question = p.question.trim();
  if (!question || question.length > ASK_QUESTION_MAX_CHARS) throw err('INVALID_VALUE', `질문은 1~${ASK_QUESTION_MAX_CHARS}자로 입력하세요.`);
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  const texts = await readNoticeTexts(store, { noticeId: p.noticeId });
  const { docs, verify } = buildDocs(texts, p.fieldDocText);
  const warnings: string[] = [];

  let contextMode = p.contextMode;
  let segments: ContextSegment[] = [];
  if (contextMode === 'full') {
    segments = fullSegments(docs);
    if (segments.reduce((n, s) => n + s.text.length, 0) > ASK_FULL_MAX_CHARS) {
      warnings.push(`문서 전문이 ${ASK_FULL_MAX_CHARS.toLocaleString('en-US')}자를 넘어 관련 부분만 보냈습니다.`);
      contextMode = 'context';
    }
  }
  if (contextMode === 'context') {
    segments = selectContext(docs, Object.fromEntries(docs.map((d) => [d.id, buildUnits(d.lines)])), question);
  }
  if (segments.length === 0) throw err('NO_DOCUMENTS', '질문에 쓸 문서가 없습니다.');

  const built = buildAskPrompt({ runId: p.askId, question, docs, segments });
  const files = docs
    .map((d) => ({ docId: d.id, name: d.label, chars: segments.filter((s) => s.docId === d.id).reduce((n, s) => n + s.text.length, 0) }))
    .filter((f) => f.chars > 0);
  const base: AskRecord = {
    id: p.askId, createdAt: now().toISOString(), question, provider: p.provider, model: p.api.model, promptVersion: ASK_PROMPT_VERSION,
    contextMode, contextChars: files.reduce((n, f) => n + f.chars, 0), files, status: 'failed', citations: [], conflicts: [], warnings,
    promptPath: askPromptPath(notice.folder, p.askId), extractionJobId: texts.extractionJobId,
    ...(notice.detailText?.capturedAt ? { detailCapturedAt: notice.detailText.capturedAt } : {}),
  };

  const r = await callProvider(
    PROVIDERS[p.provider],
    { apiKey: p.api.key, model: p.api.model, system: built.system, user: built.user, schema: askOutputSchema(p.askId), schemaName: 'bidmate_search_ask', maxTokens: ASK_MAX_TOKENS },
    { fetch: p.fetch, signal: p.signal, retryDelayMs: deps.retryDelayMs },
  );
  const closed = (): boolean => !!p.signal?.aborted || (!r.ok && r.error.code === 'AI_RUN_CLOSED');
  const abort = () => err('AI_RUN_CLOSED', '취소되었습니다.');

  const as = new AskStore(store);
  // 저장은 전부 finish를 거친다. 취소 확인은 파일을 쓰기 전과 기록하기 직전에 한다(고아 txt를 남기지 않는다).
  const finish = async (rec: AskRecord, response?: string): Promise<AskRecord> => {
    if (closed()) throw abort();
    const done: AskRecord = { ...rec, finishedAt: now().toISOString() };
    // 프롬프트·응답 txt에는 키를 남기지 않는다(저장 직전에도 가린다).
    await as.writePrompt(notice, p.askId, redactKey(`${built.system}

${built.user}`, p.api.key));
    if (response !== undefined) {
      await as.writeResponse(notice, p.askId, redactKey(response, p.api.key));
      done.responsePath = askResponsePath(notice.folder, p.askId);
    }
    if (closed()) {
      for (const path of [askPromptPath(notice.folder, p.askId), askResponsePath(notice.folder, p.askId)]) await store.remove(path).catch(() => undefined);
      throw abort();
    }
    await as.mutate(notice, (f: AskFile) => { f.asks = [done, ...f.asks.filter((a) => a.id !== done.id)]; });
    return done;
  };

  if (!r.ok) return finish({ ...base, error: { code: r.error.code, message: redactKey(r.error.message, p.api.key) } });
  const truncated = r.finish === 'length';
  const parsed = parseAskResponse(r.text, { runId: p.askId });
  if (!parsed.ok) {
    return finish({
      ...base, ...(r.usage ? { usage: r.usage } : {}),
      error: truncated ? { code: 'AI_TRUNCATED', message: 'AI 응답이 길이 제한으로 잘려 읽을 수 없습니다.' } : { code: parsed.code, message: parsed.message },
    }, r.text);
  }
  if (truncated) warnings.push('AI 응답이 길이 제한으로 잘렸습니다.');
  const citations = locateCitations(parsed.citations, verify, warnings);
  const conflicts = locateConflicts(parsed.conflicts, verify, warnings);
  return finish({
    ...base, status: 'done', answer: parsed.answer, coverage: parsed.coverage, citations, conflicts, ...(r.usage ? { usage: r.usage } : {}),
  }, r.text);
}

/** 공고의 질문 이력. 공고나 파일이 없으면 null. */
export async function getAsks(store: IFileStore, noticeId: string): Promise<AskFile | null> {
  const notice = await new NoticeStore(store).loadNotice(noticeId);
  if (!notice) return null;
  return new AskStore(store).load(notice);
}
