import { describe, expect, it } from 'vitest';
import { removeTree } from '../../src/engine/file-store/remove-tree';
import { MemoryStore } from '../helpers/memory-store';

describe('removeTree', () => {
  it('중첩 디렉터리의 파일을 모두 지운다', async () => {
    const mem = new MemoryStore();
    await mem.writeText('d/a.txt', '1');
    await mem.writeText('d/sub/b.txt', '2');
    await mem.writeText('d/sub/deep/c.txt', '3');
    await mem.writeText('other/x.txt', '4');
    await removeTree(mem, 'd');
    expect([...mem.files.keys()]).toEqual(['other/x.txt']);
  });

  it('없는 경로는 무시한다', async () => {
    const mem = new MemoryStore();
    await expect(removeTree(mem, 'nope')).resolves.toBeUndefined();
  });

  it('list가 NotFoundError면 조용히 return, 다른 오류면 throw', async () => {
    const mem = new MemoryStore();
    mem.list = async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); };
    await expect(removeTree(mem, 'd')).resolves.toBeUndefined();
    mem.list = async () => { throw Object.assign(new Error('x'), { name: 'InvalidStateError' }); };
    await expect(removeTree(mem, 'd')).rejects.toMatchObject({ name: 'InvalidStateError' });
  });
});
