import type { DocModel } from '../../core/doc/model';
import { renderText } from '../../core/doc/render-text';
import { classifyName, extOf, planFiles, twinKey, type DocKind } from '../../core/extraction/classify';
import { computeStatus, decide } from '../../core/extraction/decide';
import { conflictCountOf, isNotApplicable, NA_NOTE, reviewCountOf } from '../../core/extraction/review-count';
import { runRules, type RuleDocInput } from '../../core/extraction/run-rules';
import type { RuleSet } from '../../core/extraction/rules/schema';
import { docDateToIso } from '../../core/model/dates';
import { mergeDocumentLayer } from '../../core/model/merge';
import { EVALUATION_KEYS, getField, setFields, type FieldMap } from '../../core/model/notice-fields';
import { withNamePrefix, withoutNamePrefix } from '../../core/model/names';
import { sanitizeSegment } from '../../core/model/sanitize';
import type { FieldValue } from '../../core/types/common';
import { EXTRACTION_KEYS, EXTRACTION_SCHEMA_VERSION, type Extraction, type ExtractionFile, type ExtractionFileStatus, type ExtractedItem, type ExtractionKey, type EvidenceRef } from '../../core/types/extraction';
import type { Job, JobError, JobProgress, ProgressEvent } from '../../core/types/job';
import type { Attachment, Notice } from '../../core/types/notice';
import type { Settings } from '../../core/types/settings';
import type { IFileStore } from '../file-store/types';
import type { ParserRegistry } from '../parsers/types';
import { yieldToLoop } from '../parsers/yield';
import { openZip } from '../parsers/zip';

export interface ExtractDeps {
  store: IFileStore;
  parsers: ParserRegistry;
  rules: RuleSet & { warnings?: string[] };
  emit(p: JobProgress): void;
  signal?: AbortSignal;
  now?: () => Date;
  settings: Settings['extraction'];
  readFile(path: string): Promise<Uint8Array>;
}
export interface ExtractStepOutcome { status: 'done' | 'failed' | 'cancelled'; extraction?: Extraction; error?: JobError }

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const FAIL_STATUS: Record<string, ExtractionFileStatus> = {
  unsupported: 'unsupported', encrypted: 'encrypted', drm: 'drm', scanned: 'scanned', corrupt: 'corrupt', timeout: 'timeout', cancelled: 'cancelled',
};

export { conflictCountOf, reviewCountOf };

/** 2MB(UTF-8)를 넘으면 잘라서 돌려준다. */
function capText(text: string): string {
  const enc = new TextEncoder();
  let t = text;
  while (enc.encode(t).length > TEXT_MAX_BYTES) t = t.slice(0, Math.floor(t.length * 0.9));
  return t;
}

/** 새 자동 결과에 이전 userEdited를 이식한다. 자동 값은 candidates에 남긴다. */
function transplantEdits(items: Record<ExtractionKey, ExtractedItem<unknown>>, prior: Extraction | null): string[] {
  const out: string[] = [];
  if (!prior) return out;
  for (const k of EXTRACTION_KEYS) {
    const edited = prior.items?.[k]?.userEdited;
    if (!edited) continue;
    const item = items[k];
    item.userEdited = edited;
    if (item.value !== null && item.evidence && !item.candidates) item.candidates = [{ value: item.value, raw: item.raw, evidence: item.evidence }];
  }
  const mgmt = prior.items?.managementScore;
  if ((!mgmt || mgmt.status === 'not_run') && !mgmt?.userEdited && prior.items?.credibilityScore?.userEdited) {
    out.push('이전 버전에서 직접 수정한 대외신인도 값은 경영상태 배점이었을 수 있습니다. 두 항목을 확인해 주세요.');
  }
  return out;
}

type FieldSourceDoc = NonNullable<FieldValue<unknown>['source']>;
const docSourceOf = (ev: EvidenceRef, fetchedAt: string): FieldSourceDoc =>
  ({ kind: 'document', ref: `${ev.attachmentId}#${ev.location}`, evidence: ev.evidence, page: ev.page, fetchedAt });

/** 추출 항목 하나를 FieldValue로 바꾼다. not_found 등 반영할 것이 없으면 undefined. */
function fieldOfItem(it: ExtractedItem<unknown>, fetchedAt: string, conflictValue: boolean): FieldValue<unknown> | undefined {
  const ev = it.evidence;
  const source = ev ? docSourceOf(ev, fetchedAt) : undefined;
  if (isNotApplicable(it) && source) {
    return { value: null, status: 'verified', note: NA_NOTE, raw: it.raw, source } as FieldValue<unknown>;
  }
  if (it.status === 'verified' && it.value !== null && source) {
    return { value: it.value, raw: it.raw, status: 'verified', source } as FieldValue<unknown>;
  }
  if (it.status === 'needs_review' && (it.reason === 'conflict' || it.reason === 'multi') && it.candidates?.length) {
    // raw가 비면 mergeFields가 값 없는 레이어를 무시해 충돌이 notice에 드러나지 않는다. 후보 원문을 raw로 남긴다.
    const raw = it.candidates.map((c) => c.raw ?? String(c.value)).join(' / ').slice(0, 200);
    // 대표값을 쓸 때는 출처도 남긴다. 없으면 다음 추출에서 문서 값으로 인식되지 않아 갱신이 막힌다.
    const top = source ?? docSourceOf(it.candidates[0]!.evidence, fetchedAt);
    return {
      value: conflictValue ? it.value : null, raw, status: 'needs_review', note: '문서 간 값이 서로 다름',
      ...(conflictValue ? { source: top } : {}),
      candidates: it.candidates.map((c) => ({ value: c.value, source: docSourceOf(c.evidence, fetchedAt) })),
    } as FieldValue<unknown>;
  }
  if (it.status === 'needs_review' && it.reason === 'low_confidence' && it.value !== null && source) {
    return { value: it.value, raw: it.raw, status: 'needs_review', note: '질의답변 문서에만 있는 값', source } as FieldValue<unknown>;
  }
  if (it.status === 'needs_review' && it.reason === 'no_total' && source && it.raw) {
    return { value: null, raw: it.raw, status: 'needs_review', note: '가감점 표만 있음, 합계 배점 없음', source } as FieldValue<unknown>;
  }
  return undefined;
}

export function docFieldsOf(items: Record<ExtractionKey, ExtractedItem<unknown>>, fetchedAt: string): FieldMap {
  const out: FieldMap = {};
  for (const k of EXTRACTION_KEYS) {
    const it = items[k];
    if (it.userEdited) continue; // 사용자 수정은 notice의 user_edited 필드가 보존한다
    const f = fieldOfItem(it, fetchedAt, false);
    if (f) out[k] = f;
    // not_found는 키를 넣지 않는다
  }
  return out;
}

/** 문서 전용 보충 필드(공고정보/API에 없을 때만 문서 값으로 채운다). */
export const DOC_FILL_KEYS = ['projectPeriod', 'evalMethodDoc', 'proposalPeriod', 'proposalEvalAt', 'quantEvalDoc'] as const;

export { docDateToIso } from '../../core/model/dates';

/** 같은 줄 규칙(extras[key])에 값이 없을 때만 쓰는 보조 규칙의 extras 키. 같은 target으로 두면 표기가 다른 같은 값끼리 충돌해 verified가 needs_review가 된다. */
const DOC_FALLBACK: Partial<Record<(typeof DOC_FILL_KEYS)[number], string[]>> = { projectPeriod: ['projectPeriodParen', 'projectPeriodCell'] };

/** 문서에서 찾은 사업기간·평가방식 원문을 필드로 바꾼다. not_found/no_total이면 키가 없다. */
export function docOnlyFieldsOf(extras: Record<string, ExtractedItem<unknown>>, fetchedAt: string): FieldMap {
  const out: FieldMap = {};
  for (const key of DOC_FILL_KEYS) {
    // 같은 줄 규칙 -> 보조 규칙 순으로 값이 되는 첫 항목을 쓴다(no_total·값 없음은 건너뜀).
    for (const k of [key, ...(DOC_FALLBACK[key] ?? [])]) {
      const it = extras[k];
      let f = it && it.reason !== 'no_total' ? fieldOfItem(it, fetchedAt, true) : undefined;
      if (f && key === 'proposalEvalAt') {
        // schedule.proposalEvalAt은 ISODate다. 변환에 실패하면 값으로 보지 않고, 후보도 변환되는 것만 남긴다.
        const iso = typeof f.value === 'string' ? docDateToIso(f.value) : null;
        if (!iso) f = undefined;
        else {
          const { candidates, ...rest } = f;
          const cs = (candidates ?? []).flatMap((c) => {
            const ci = typeof c.value === 'string' ? docDateToIso(c.value) : null;
            return ci ? [{ ...c, value: ci }] : [];
          });
          f = { ...rest, value: iso, ...(cs.length ? { candidates: cs } : {}) } as FieldValue<unknown>;
        }
      }
      if (f) { out[key] = f; break; }
    }
  }
  return out;
}

/** 상세화면/API에 값이 없을 때만 문서 값을 채운다. mergeFields는 쓰지 않는다(HTML 덮어쓰기와 상시 충돌 방지). */
export function fillDocOnlyFields(notice: Notice, fields: FieldMap): void {
  for (const key of DOC_FILL_KEYS) {
    const prev = getField(notice, key);
    if (prev?.status === 'user_edited') continue;
    if (prev && prev.value != null && prev.source?.kind !== 'document') continue;
    const next = fields[key];
    if (next) setFields(notice, { [key]: next });
    else if (prev && prev.source?.kind === 'document' && prev.value != null) {
      setFields(notice, { [key]: { ...prev, status: 'needs_review', note: '최근 추출에서 값이 확인되지 않음' } as FieldValue<unknown> });
    }
  }
}

export async function runExtractStep(job: Job, notice: Notice, prior: Extraction | null, deps: ExtractDeps): Promise<ExtractStepOutcome> {
  const now = deps.now ?? (() => new Date());
  const { settings, signal } = deps;
  const t0 = Date.now();
  const stepDeadline = t0 + settings.budgetMs;
  const maxBytes = settings.maxParseMB * 1048576;
  const title = typeof notice.basic.title?.value === 'string' ? notice.basic.title.value : null;
  const plan = planFiles(notice.attachments, title);
  for (const p of plan) p.attachment.docKind = p.classified.kind;

  const order = plan.map((p, i) => ({ p, i })).filter((x) => x.p.action === 'parse')
    .sort((a, b) => a.p.classified.priority - b.p.classified.priority
      || (a.p.attachment.origin === 'prespec' ? 1 : 0) - (b.p.attachment.origin === 'prespec' ? 1 : 0) || a.i - b.i);
  const total = order.length;
  const slots: ExtractionFile[][] = plan.map(() => []);
  const inputs: RuleDocInput[] = [];
  const warnings: string[] = [];
  const usedText = new Set<string>();
  let attempted = 0;

  const step = (status: JobProgress['status'], label: string, progress?: JobProgress['progress'], event?: ProgressEvent) =>
    deps.emit({ jobId: job.id, attempt: job.attempt, step: 'extract', status, label, progress, ...(event ? { event } : {}) });
  const fileInfo = (a: Attachment) => ({ id: a.id, name: a.originalName, size: a.savedSize });
  /** 첨부 하나의 결과를 file end 이벤트로 낸다(zip 내부 엔트리별 이벤트는 없다). */
  const fileEnd = (a: Attachment, rows: ExtractionFile[], label: string, progress: JobProgress['progress']) => {
    const first = rows.find((r) => r.error);
    const ms = rows.reduce((sum, r) => sum + (r.ms ?? 0), 0);
    step('running', label, progress, {
      kind: 'file', step: 'extract', phase: 'end', file: fileInfo(a),
      status: rows.some((r) => r.status === 'parsed') ? 'parsed' : rows[0]?.status, ms, ...(first?.error ? { error: first.error } : {}),
    });
  };
  const baseRow = (att: Attachment, kind: DocKind, priority: number, innerPath?: string): ExtractionFile => {
    const r: ExtractionFile = { attachmentId: att.id, name: att.originalName, docKind: kind, priority, status: 'skipped' };
    if (att.origin) r.origin = att.origin;
    if (innerPath !== undefined) r.innerPath = innerPath;
    return r;
  };
  const overBudget = () => attempted > 0 && Date.now() >= stepDeadline;

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i]!;
    if (p.action === 'skip') slots[i]!.push({ ...baseRow(p.attachment, p.classified.kind, p.classified.priority), status: 'skipped', skipReason: p.skipReason });
  }

  /** 바이트 하나를 파싱해 행을 채운다. 취소되면 'cancelled'를 돌려준다. */
  const parseBytes = async (att: Attachment, kind: DocKind, priority: number, name: string, bytes: Uint8Array, innerPath: string | undefined, textName: string): Promise<ExtractionFile | 'cancelled'> => {
    const row = baseRow(att, kind, priority, innerPath);
    const started = Date.now();
    const fmt = deps.parsers.detect(name, bytes.subarray(0, 32), bytes);
    row.format = fmt;
    if (fmt === 'hwp3' || fmt === 'unknown' || fmt === 'zip') { row.status = 'unsupported'; return row; }
    let res;
    try {
      res = await deps.parsers.get(fmt).parse({ name, bytes, signal, deadlineAt: Math.min(started + settings.fileTimeoutMs, stepDeadline) });
    } catch (e) {
      row.status = 'failed';
      row.error = e instanceof Error ? e.message : String(e);
      row.ms = Date.now() - started;
      return row;
    }
    row.ms = Date.now() - started;
    if (!res.ok) {
      if (signal?.aborted || res.reason === 'cancelled') return 'cancelled';
      row.status = FAIL_STATUS[res.reason] ?? 'failed';
      row.error = res.message;
      return row;
    }
    const doc: DocModel = res.doc;
    row.status = 'parsed';
    row.pages = doc.pages; row.chars = doc.stats.chars; row.tables = doc.stats.tables;
    let path = `${notice.folder}/source/text/${textName}`;
    for (let n = 2; usedText.has(path); n++) path = `${notice.folder}/source/text/${textName.replace(/\.txt$/, '')}_${n}.txt`;
    usedText.add(path);
    await deps.store.writeText(path, capText(renderText(doc)));
    row.textPath = path;
    for (const w of doc.warnings) warnings.push(`${innerPath ?? name}: ${w}`);
    inputs.push({ doc, attachmentId: att.id, sourceFile: innerPath ? `${att.originalName}/${innerPath}` : att.originalName, docKind: kind, priority, ...(att.origin ? { origin: att.origin } : {}) });
    return row;
  };

  /** 첨부 하나(zip이면 엔트리들)를 처리한다. */
  const processAttachment = async (att: Attachment, kind: DocKind, priority: number): Promise<ExtractionFile[] | 'cancelled'> => {
    const path = `${notice.folder}/attachments/${att.savedName}`;
    // 추출 텍스트도 첨부와 같은 태그를 파일명 맨 앞에 붙인다: `[태그] 0_공고문.hwp.txt`
    const bare = `${att.index}_${withoutNamePrefix(att.savedName ?? '', att.namePrefix)}`;
    const textFile = (suffix = ''): string => `${withNamePrefix(`${bare}${suffix}`, att.namePrefix)}.txt`;
    if (att.savedSize !== null && att.savedSize > maxBytes) return [{ ...baseRow(att, kind, priority), skipReason: 'too_large' }];
    let bytes: Uint8Array;
    try {
      bytes = await deps.readFile(path);
    } catch (e) {
      return [{ ...baseRow(att, kind, priority), status: 'failed', skipReason: undefined, error: e instanceof Error ? e.message : String(e) }];
    }
    if (bytes.length > maxBytes) return [{ ...baseRow(att, kind, priority), skipReason: 'too_large' }];
    const fmt = deps.parsers.detect(att.originalName, bytes.subarray(0, 32), bytes);
    if (fmt !== 'zip') {
      const r = await parseBytes(att, kind, priority, att.originalName, bytes, undefined, textFile());
      return r === 'cancelled' ? 'cancelled' : [r];
    }
    // zip: 엔트리를 1~4급만 풀고, 중첩 zip은 1단계까지만 연다.
    const rows: ExtractionFile[] = [];
    const walk = async (zipBytes: Uint8Array, prefix: string, depth: number): Promise<'cancelled' | undefined> => {
      let archive;
      try { archive = openZip(zipBytes); } catch (e) {
        rows.push({ ...baseRow(att, kind, priority, prefix || undefined), status: 'corrupt', skipReason: undefined, error: e instanceof Error ? e.message : String(e) });
        return;
      }
      for (const entry of archive.entries) {
        if (entry.isDir) continue;
        if (signal?.aborted) return 'cancelled';
        const inner = prefix ? `${prefix}/${entry.path}` : entry.path;
        const base = entry.path.split('/').pop() ?? entry.path;
        const ext = extOf(base);
        const c = classifyName(base, title);
        if (ext === 'zip') {
          if (depth >= 1 || c.priority === 0) continue;
          if (entry.size > maxBytes) { rows.push({ ...baseRow(att, c.kind, c.priority, inner), skipReason: 'too_large' }); continue; }
          try {
            if ((await walk(archive.read(entry.path), inner, depth + 1)) === 'cancelled') return 'cancelled';
          } catch { /* 읽기 실패한 중첩 zip은 건너뜀 */ }
          continue;
        }
        if (c.priority < 1 || c.priority > 4) continue;
        if (!['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'xlsm', 'txt'].includes(ext)) continue;
        if (overBudget()) { rows.push({ ...baseRow(att, c.kind, c.priority, inner), skipReason: 'budget' }); continue; }
        if (entry.size > maxBytes) { rows.push({ ...baseRow(att, c.kind, c.priority, inner), skipReason: 'too_large' }); continue; }
        let eb: Uint8Array;
        try { eb = archive.read(entry.path); } catch (e) {
          rows.push({ ...baseRow(att, c.kind, c.priority, inner), status: 'failed', error: e instanceof Error ? e.message : String(e) });
          continue;
        }
        const r = await parseBytes(att, c.kind, c.priority, base, eb, inner, textFile(`__${sanitizeSegment(inner, 80)}`));
        if (r === 'cancelled') return 'cancelled';
        rows.push(r);
        await yieldToLoop();
      }
    };
    if ((await walk(bytes, '', 0)) === 'cancelled') return 'cancelled';
    return rows.length ? rows : [{ ...baseRow(att, kind, priority), skipReason: 'excluded' }];
  };

  const cancelledOutcome = (): ExtractStepOutcome => ({ status: 'cancelled' });
  let done = 0;
  for (const { p, i } of order) {
    if (signal?.aborted) return cancelledOutcome();
    done++;
    const att = p.attachment;
    if (overBudget()) { slots[i] = [{ ...baseRow(att, p.classified.kind, p.classified.priority), skipReason: 'budget' }]; continue; }
    const runLabel = `평가정보 추출 중 (${done}/${total}), ${att.originalName}`;
    step('running', runLabel, { done: done - 1, total }, { kind: 'file', step: 'extract', phase: 'start', file: fileInfo(att) });
    attempted++;
    await yieldToLoop();
    const rows = await processAttachment(att, p.classified.kind, p.classified.priority);
    if (rows === 'cancelled' || signal?.aborted) return cancelledOutcome();
    slots[i] = rows;
    fileEnd(att, rows, runLabel, { done: done - 1, total });
    // 쌍둥이 폴백: 저장된 hwp/hwpx가 파싱되지 않았으면 같은 이름의 pdf(duplicate로 건너뛴 것)를 대신 파싱한다.
    const ext = extOf(att.originalName);
    if ((ext === 'hwp' || ext === 'hwpx') && !rows.some((r) => r.status === 'parsed')) {
      const key = twinKey(att.originalName);
      const j = plan.findIndex((q) => q.skipReason === 'duplicate' && twinKey(q.attachment.originalName) === key);
      if (j >= 0 && !overBudget()) {
        const q = plan[j]!;
        step('running', runLabel, { done: done - 1, total }, { kind: 'file', step: 'extract', phase: 'start', file: fileInfo(q.attachment) });
        const fr = await processAttachment(q.attachment, q.classified.kind, q.classified.priority);
        if (fr === 'cancelled' || signal?.aborted) return cancelledOutcome();
        slots[j] = fr;
        fileEnd(q.attachment, fr, runLabel, { done: done - 1, total });
      }
    }
  }
  if (signal?.aborted) return cancelledOutcome();

  const files = slots.flat();
  const { candidates, warnings: rw } = runRules(inputs, deps.rules);
  warnings.push(...rw);
  const { items, extras } = decide(candidates, deps.rules);
  if (!files.some((f) => f.status === 'parsed')) {
    for (const k of EXTRACTION_KEYS) if (items[k].reason === 'not_found') items[k].reason = 'no_documents';
  }
  warnings.push(...transplantEdits(items, prior));
  const nowIso = now().toISOString();
  const status = computeStatus(items, files.map((f) => f.status));
  const extraction: Extraction = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION, noticeId: notice.id, jobId: job.id, extractedAt: nowIso, rulesVersion: deps.rules.version,
    status, items, extras, files, warnings: [...(deps.rules.warnings ?? []), ...warnings],
  };

  if (status === 'failed') {
    const first = files.find((f) => f.error);
    step('failed', '평가정보 추출 실패', { done: total, total });
    return {
      status: 'failed', extraction,
      error: { code: 'EXTRACT_FAILED', message: `평가정보 추출 실패${first?.error ? `: ${first.name}: ${first.error}` : ''}`, step: 'extract', retryable: true },
    };
  }
  const merged = mergeDocumentLayer(notice, docFieldsOf(items, nowIso));
  const evalOnly: FieldMap = {};
  for (const k of EVALUATION_KEYS) if (!(DOC_FILL_KEYS as readonly string[]).includes(k) && merged[k]) evalOnly[k] = merged[k];
  setFields(notice, evalOnly);
  fillDocOnlyFields(notice, docOnlyFieldsOf(extras, nowIso));

  step('done', `평가정보 추출 완료, 확인 필요 ${reviewCountOf(extraction)}건`, { done: total, total });
  return { status: 'done', extraction };
}
