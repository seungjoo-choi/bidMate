import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../helpers/memory-store';

describe('IFileStore.readBytes', () => {
  it('MemoryStore에서 왕복된다', async () => {
    const s = new MemoryStore();
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    await s.writeStream('a/b.bin', new Blob([bytes]).stream());
    expect(await s.readBytes('a\\b.bin')).toEqual(bytes);
    await s.writeText('t.txt', '한글');
    expect(new TextDecoder().decode(await s.readBytes('t.txt'))).toBe('한글');
  });
});
