import { describe, expect, it } from 'vitest';
import { matchAttachments } from '../../src/engine/jobs/attachments';
import type { Attachment } from '../../src/core/types/notice';

const nx = (name: string, url: string) => ({ originalName: name, url, expectedSize: null });

describe('matchAttachments', () => {
  it('같은 originalName 2개를 재수집해도 id/savedName이 중복되지 않는다', () => {
    const first = matchAttachments([], [nx('a.pdf', 'u1'), nx('a.pdf', 'u2')], 'N-000')
      .map((a, i) => ({ ...a, savedName: i === 0 ? 'a.pdf' : 'a (2).pdf', status: 'saved' as const, savedSize: 3 }));
    const again = matchAttachments(first, [nx('a.pdf', 'u1'), nx('a.pdf', 'u2')], 'N-000');
    expect(new Set(again.map((a) => a.id)).size).toBe(2);
    expect(again.map((a) => a.id)).toEqual(['N-000:a0', 'N-000:a1']);
    expect(again.map((a) => a.savedName)).toEqual(['a.pdf', 'a (2).pdf']);
  });
  it('url이 같으면 savedName과 상태를 이어받는다(순서가 바뀌어도)', () => {
    const prev: Attachment[] = [
      { id: 'x', index: 0, originalName: 'a.pdf', savedName: 'a.pdf', url: 'u1', expectedSize: null, savedSize: 3, status: 'saved', attempts: 1 },
      { id: 'y', index: 1, originalName: 'b.pdf', savedName: 'b.pdf', url: 'u2', expectedSize: null, savedSize: 4, status: 'saved', attempts: 1 },
    ];
    const out = matchAttachments(prev, [nx('b.pdf', 'u2'), nx('a.pdf', 'u1')], 'N-000');
    expect(out[0]).toMatchObject({ savedName: 'b.pdf', status: 'saved', savedSize: 4, index: 0 });
    expect(out[1]).toMatchObject({ savedName: 'a.pdf', index: 1 });
  });
  it('이어받은 savedName이 충돌하면 뒤쪽을 pending으로 되돌린다', () => {
    const mk = (id: string, url: string): Attachment => ({ id, index: 0, originalName: 'a.pdf', savedName: 'a.pdf', url, expectedSize: null, savedSize: 3, status: 'saved', attempts: 1 });
    const out = matchAttachments([mk('x', 'u1'), mk('y', 'u2')], [nx('a.pdf', 'u1'), nx('a.pdf', 'u2')], 'N-000');
    expect(out[0]?.savedName).toBe('a.pdf');
    expect(out[1]?.savedName).not.toBe('a.pdf');
    expect(out[1]?.status).toBe('pending');
  });
});
