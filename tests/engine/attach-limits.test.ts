import { describe, expect, it } from 'vitest';
import { selectAttachTargets } from '../../src/engine/mail/attach-limits';

const f = (name: string, size: number) => ({ name, size });

describe('selectAttachTargets', () => {
  it('제한이 없으면 전부 대상이고 순서를 유지한다', () => {
    const r = selectAttachTargets([f('a', 3), f('b', 1), f('c', 2)], 100);
    expect(r.targets.map((x) => x.name)).toEqual(['a', 'b', 'c']);
    expect(r.skipped).toEqual([]);
  });
  it('maxBytes 초과는 FILE_TOO_LARGE', () => {
    const r = selectAttachTargets([f('a', 11), f('b', 10)], 10, { perFileBytes: 5 });
    expect(r.skipped.map((x) => [x.file.name, x.error])).toEqual([['a', 'FILE_TOO_LARGE'], ['b', 'PROVIDER_FILE_LIMIT']]);
    expect(r.targets).toEqual([]);
  });
  it('perFileBytes 초과는 PROVIDER_FILE_LIMIT, 경계값은 통과', () => {
    const r = selectAttachTargets([f('a', 6), f('b', 5)], 100, { perFileBytes: 5 });
    expect(r.skipped.map((x) => [x.file.name, x.error])).toEqual([['a', 'PROVIDER_FILE_LIMIT']]);
    expect(r.targets.map((x) => x.name)).toEqual(['b']);
  });
  it('누적이 totalBytes를 넘으면 그 파일만 PROVIDER_TOTAL_LIMIT, 다음 작은 파일은 계속 판정', () => {
    const r = selectAttachTargets([f('a', 6), f('b', 5), f('c', 4)], 100, { totalBytes: 10 });
    expect(r.targets.map((x) => x.name)).toEqual(['a', 'c']);
    expect(r.skipped.map((x) => [x.file.name, x.error])).toEqual([['b', 'PROVIDER_TOTAL_LIMIT']]);
  });
  it('건너뛴 파일은 누적에 더하지 않는다', () => {
    const r = selectAttachTargets([f('a', 20), f('b', 6), f('c', 4)], 100, { perFileBytes: 10, totalBytes: 10 });
    expect(r.targets.map((x) => x.name)).toEqual(['b', 'c']);
  });
});
