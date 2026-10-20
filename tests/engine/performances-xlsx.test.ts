// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildTemplateXlsx, parsePerformanceXlsx } from '../../src/engine/performances/xlsx-io';

describe('performances xlsx', () => {
  it('양식을 다시 읽으면 예시 행 1개가 정상으로 해석된다', async () => {
    const r = await parsePerformanceXlsx(buildTemplateXlsx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(1);
    expect(r.invalid).toBe(0);
    expect(r.rows[0]!.row).toBe(2);
    expect(r.rows[0]!.input).toMatchObject({
      title: 'OO시스템 구축', client: 'OO공단', amount: 350000000, startAt: '2024-03-01', endAt: '2024-12-31', category: '정보시스템',
    });
  });
  it('빈 바이트는 ok:false', async () => {
    const r = await parsePerformanceXlsx(new Uint8Array());
    expect(r.ok).toBe(false);
  });
});
