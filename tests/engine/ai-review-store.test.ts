import { describe, expect, it } from 'vitest';
import type { AiRun } from '../../src/core/types/ai';
import { AiReviewStore, aiPromptPath, aiResponsePath } from '../../src/engine/ai/ai-review-store';
import { MemoryStore } from '../helpers/memory-store';

const n = { id: 'N1', folder: 'notices/2026/N1_x' };
const mkRun = (id: string): AiRun => ({
  id, createdAt: 't', provider: 'claude', mode: 'api', model: 'm', promptVersion: '1.0.0', scope: 'all', keys: [],
  extractionJobId: 'j', extractedAt: 't', status: 'done', files: [], skipped: [], excerptChars: 0, truncated: false,
  warnings: [], suggestions: {}, rejected: [], promptPath: aiPromptPath(n.folder, id),
});

describe('AiReviewStore', () => {
  it('최신 먼저 쌓고 10개를 넘으면 오래된 run과 txt를 지운다', async () => {
    const mem = new MemoryStore();
    const s = new AiReviewStore(mem);
    for (let i = 1; i <= 12; i++) {
      await s.writePrompt(n, `r${i}`, 'p');
      await s.writeResponse(n, `r${i}`, 'x');
      await s.upsertRun(n, mkRun(`r${i}`));
    }
    const f = (await s.load(n))!;
    expect(f.runs.map((r) => r.id)).toEqual(['r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3']);
    expect(mem.files.has(aiPromptPath(n.folder, 'r1'))).toBe(false);
    expect(mem.files.has(aiResponsePath(n.folder, 'r2'))).toBe(false);
    expect(mem.files.has(aiPromptPath(n.folder, 'r3'))).toBe(true);
  });

  it('10개 초과 정리는 awaiting·requesting run을 지우지 않고 닫힌 오래된 run부터 지운다', async () => {
    const mem = new MemoryStore();
    const s = new AiReviewStore(mem);
    await s.upsertRun(n, { ...mkRun('old-awaiting'), status: 'awaiting' });
    await s.upsertRun(n, { ...mkRun('old-requesting'), status: 'requesting' });
    for (let i = 1; i <= 10; i++) await s.upsertRun(n, mkRun(`d${i}`));
    const ids = (await s.load(n))!.runs.map((r) => r.id);
    expect(ids).toContain('old-awaiting');
    expect(ids).toContain('old-requesting');
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('d1');
    expect(ids).not.toContain('d2');
    expect(ids).toContain('d10');
  });

  it('같은 id의 upsert는 교체하고, 손상·없음은 null로 읽는다', async () => {
    const mem = new MemoryStore();
    const s = new AiReviewStore(mem);
    expect(await s.load(n)).toBeNull();
    await s.upsertRun(n, mkRun('a'));
    await s.upsertRun(n, { ...mkRun('a'), status: 'failed' });
    expect((await s.load(n))!.runs).toHaveLength(1);
    expect((await s.load(n))!.runs[0]!.status).toBe('failed');
    mem.files.set(`${n.folder}/ai-review.json`, '{깨짐');
    expect(await s.load(n)).toBeNull();
    mem.files.set(`${n.folder}/ai-review.json`, JSON.stringify({ schemaVersion: 2, runs: [] }));
    expect(await s.load(n)).toBeNull();
    // 손상 파일 위에도 새로 쓸 수 있다
    await s.upsertRun(n, mkRun('b'));
    expect((await s.load(n))!.runs.map((r) => r.id)).toEqual(['b']);
  });
});
