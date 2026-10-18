import type { DocModel } from '../../core/doc/model';
import { renderText } from '../../core/doc/render-text';
import { classifyName, extOf, planFiles, twinKey, type DocKind } from '../../core/extraction/classify';
import { computeStatus, decide } from '../../core/extraction/decide';
import { runRules, type RuleDocInput } from '../../core/extraction/run-rules';
import type { RuleSet } from '../../core/extraction/rules/schema';
import { mergeDocumentLayer } from '../../core/model/merge';
import { EVALUATION_KEYS, setFields, type FieldMap } from '../../core/model/notice-fields';
import { sanitizeSegment } from '../../core/model/sanitize';
import type { FieldValue } from '../../core/types/common';
import { EXTRACTION_KEYS, EXTRACTION_SCHEMA_VERSION, type Extraction, type ExtractionFile, type ExtractionFileStatus, type ExtractedItem, type ExtractionKey } from '../../core/types/extraction';
import type { Job, JobError, JobProgress } from '../../core/types/job';
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

/** needs_review이면서 사용자가 수정하지 않은 항목 수. */
export function reviewCountOf(x: Extraction): number {
  return EXTRACTION_KEYS.filter((k) => x.items[k].status === 'needs_review' && x.items[k].userEdited === undefined).length;
}

/** needs_review이고 reason이 conflict/low_confidence이며 사용자가 수정하지 않은 항목 수. */
export function conflictCountOf(x: Extraction): number {
  return EXTRACTION_KEYS.filter((k) => {
    const it = x.items[k];
    return it.status === 'needs_review' && (it.reason === 'conflict' || it.reason === 'low_confidence') && it.userEdited === undefined;
  }).length;
}

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

export function docFieldsOf(items: Record<ExtractionKey, ExtractedItem<unknown>>, fetchedAt: string): FieldMap {
  const out: FieldMap = {};
  for (const k of EXTRACTION_KEYS) {
    const it = items[k];
    if (it.userEdited) continue; // 사용자 수정은 notice의 user_edited 필드가 보존한다
    const ev = it.evidence;
    const source = ev ? { kind: 'document' as const, ref: `${ev.attachmentId}#${ev.location}`, evidence: ev.evidence, page: ev.page, fetchedAt } : undefined;
    if (it.status === 'verified' && it.value !== null && source) {
      out[k] = { value: it.value, raw: it.raw, status: 'verified', source } as FieldValue<unknown>;
    } else if (it.status === 'needs_review' && it.reason === 'conflict' && it.candidates?.length) {
      // raw가 비면 mergeFields가 값 없는 레이어를 무시해 충돌이 notice에 드러나지 않는다. 후보 원문을 raw로 남긴다.
      const raw = it.candidates.map((c) => c.raw ?? String(c.value)).join(' / ').slice(0, 200);
      out[k] = {
        value: null, raw, status: 'needs_review', note: '문서 간 값이 서로 다름',
        candidates: it.candidates.map((c) => ({
          value: c.value,
          source: { kind: 'document' as const, ref: `${c.evidence.attachmentId}#${c.evidence.location}`, evidence: c.evidence.evidence, page: c.evidence.page, fetchedAt },
        })),
      } as FieldValue<unknown>;
    } else if (it.status === 'needs_review' && it.reason === 'low_confidence' && it.value !== null && source) {
      out[k] = { value: it.value, raw: it.raw, status: 'needs_review', note: '질의답변 문서에만 있는 값', source } as FieldValue<unknown>;
    }
    // not_found는 키를 넣지 않는다
  }
  return out;
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
    .sort((a, b) => a.p.classified.priority - b.p.classified.priority || a.i - b.i);
  const total = order.length;
  const slots: ExtractionFile[][] = plan.map(() => []);
  const inputs: RuleDocInput[] = [];
  const warnings: string[] = [];
  const usedText = new Set<string>();
  let attempted = 0;

  const step = (status: JobProgress['status'], label: string, progress?: JobProgress['progress']) =>
    deps.emit({ jobId: job.id, attempt: job.attempt, step: 'extract', status, label, progress });
  const baseRow = (att: Attachment, kind: DocKind, priority: number, innerPath?: string): ExtractionFile => {
    const r: ExtractionFile = { attachmentId: att.id, name: att.originalName, docKind: kind, priority, status: 'skipped' };
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
    inputs.push({ doc, attachmentId: att.id, sourceFile: innerPath ? `${att.originalName}/${innerPath}` : att.originalName, docKind: kind, priority });
    return row;
  };

  /** 첨부 하나(zip이면 엔트리들)를 처리한다. */
  const processAttachment = async (att: Attachment, kind: DocKind, priority: number): Promise<ExtractionFile[] | 'cancelled'> => {
    const path = `${notice.folder}/attachments/${att.savedName}`;
    const textBase = `${att.index}_${att.savedName}`;
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
      const r = await parseBytes(att, kind, priority, att.originalName, bytes, undefined, `${textBase}.txt`);
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
        const r = await parseBytes(att, c.kind, c.priority, base, eb, inner, `${att.index}_${att.savedName}__${sanitizeSegment(inner, 80)}.txt`);
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
    step('running', `평가정보 추출 중 (${done}/${total}), ${att.originalName}`, { done: done - 1, total });
    attempted++;
    await yieldToLoop();
    const rows = await processAttachment(att, p.classified.kind, p.classified.priority);
    if (rows === 'cancelled' || signal?.aborted) return cancelledOutcome();
    slots[i] = rows;
    // 쌍둥이 폴백: 저장된 hwp/hwpx가 파싱되지 않았으면 같은 이름의 pdf(duplicate로 건너뛴 것)를 대신 파싱한다.
    const ext = extOf(att.originalName);
    if ((ext === 'hwp' || ext === 'hwpx') && !rows.some((r) => r.status === 'parsed')) {
      const key = twinKey(att.originalName);
      const j = plan.findIndex((q) => q.skipReason === 'duplicate' && twinKey(q.attachment.originalName) === key);
      if (j >= 0 && !overBudget()) {
        const q = plan[j]!;
        const fr = await processAttachment(q.attachment, q.classified.kind, q.classified.priority);
        if (fr === 'cancelled' || signal?.aborted) return cancelledOutcome();
        slots[j] = fr;
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
  for (const k of EVALUATION_KEYS) if (merged[k]) evalOnly[k] = merged[k];
  setFields(notice, evalOnly);

  step('done', `평가정보 추출 완료, 확인 필요 ${reviewCountOf(extraction)}건`, { done: total, total });
  return { status: 'done', extraction };
}
