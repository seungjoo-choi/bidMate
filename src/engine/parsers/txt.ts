import type { DocBlock, DocModel } from '../../core/doc/model';
import type { DocParser } from './types';

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

export const txtParser: DocParser = {
  id: 'txt',
  format: 'txt',
  async parse(input) {
    const t0 = Date.now();
    if (input.signal?.aborted) return { ok: false, reason: 'cancelled', message: '취소됨' };
    if (t0 > input.deadlineAt) return { ok: false, reason: 'timeout', message: '시간 초과' };
    try {
      const text = decodeText(input.bytes).replace(/^﻿/, '');
      const blocks: DocBlock[] = text.split(/\r\n|\r|\n/).map((line, i) => ({ kind: 'p', text: line, loc: { block: i } }));
      const doc: DocModel = {
        format: 'txt', blocks, warnings: [],
        stats: { chars: text.length, tables: 0, ms: Date.now() - t0 },
      };
      return { ok: true, doc };
    } catch (e) {
      return { ok: false, reason: 'corrupt', message: (e as Error).message };
    }
  },
};
