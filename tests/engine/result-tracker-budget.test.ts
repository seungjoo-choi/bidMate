import { describe, expect, it, vi } from 'vitest';
import type { ResultFile } from '../../src/core/types/result';
import { runResultRefresh } from '../../src/engine/results/result-tracker';
import { fakeG2b, NOW, OURS, seedStore } from '../helpers/result-fixture';

vi.mock('../../src/core/results/limits', async (orig) => ({ ...(await orig<typeof import('../../src/core/results/limits')>()), REANNOUNCE_CALL_BUDGET: 4 }));

const PAST = '2026-10-20T09:00:00+09:00';

describe('재공고 감시 호출 예산', () => {
  it('예산을 다 쓰면 남은 비팔로우 항목의 nextCheckAt은 그대로다', async () => {
    const ids = ['R26BK00000011-000', 'R26BK00000012-000', 'R26BK00000013-000'];
    const s = seedStore(ids.map((id) => ({ id, openingAt: PAST })));
    const w = { status: 'watching', nextCheckAt: PAST, attempts: 0, orgCode: 'B1' };
    const entries = Object.fromEntries(ids.map((id, i) => [id, {
      noticeId: id, noticeNo: id.slice(0, 13), round: '000', status: 'no_bid', openingAt: PAST, startAt: PAST, attempts: 0, nextCheckAt: PAST, checkedAt: PAST,
      reannounce: { ...w, since: new Date(NOW.getTime() - (i + 1) * 3600_000).toISOString() },
    }]));
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: OURS, updatedAt: '', entries }));
    const g = fakeG2b(() => []);
    await runResultRefresh({ store: s, fetch: g.fetch, serviceKey: 'KEY', bizNo: '123-45-67890', now: () => NOW, checkPermission: async () => true }, { mode: 'list' });
    // opKind가 없으면 첫 항목이 4종 전부 검색해 예산 4를 다 쓴다.
    expect(g.calls.filter((u) => u.includes('PPSSrch'))).toHaveLength(4);
    const saved = JSON.parse(s.files.get('results.json') as string) as ResultFile;
    expect(saved.entries[ids[0]!]!.reannounce!.nextCheckAt).not.toBe(PAST);
    expect(saved.entries[ids[1]!]!.reannounce!.nextCheckAt).toBe(PAST);
    expect(saved.entries[ids[2]!]!.reannounce!.nextCheckAt).toBe(PAST);
  });
});
