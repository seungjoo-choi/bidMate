import { describe, expect, it } from 'vitest';
import type { EvidenceRef, ExtractionFile } from '../../src/core/types/extraction';
import { evidenceTextPath, findTextPath } from '../../src/ui/review/view';

describe('evidenceTextPath', () => {
  const files: ExtractionFile[] = [{ attachmentId: 'a1', name: 'x.hwp', docKind: 'rfp', priority: 1, status: 'parsed', textPath: 'p/x.txt', chars: 10 }];
  const ev = (attachmentId: string): EvidenceRef => ({ attachmentId, sourceFile: 'x.hwp', evidence: 'q' } as EvidenceRef);
  const detail = { textPath: 'p/detail.txt', capturedAt: '2026-01-01T00:00:00Z', chars: 5 };
  it('__detail__ 근거는 detail 경로', () => {
    expect(evidenceTextPath(ev('__detail__'), files, detail)).toBe('p/detail.txt');
  });
  it('detail이 없으면 undefined', () => {
    expect(evidenceTextPath(ev('__detail__'), files)).toBeUndefined();
  });
  it('일반 근거는 findTextPath와 동일', () => {
    expect(evidenceTextPath(ev('a1'), files, detail)).toBe(findTextPath(files, ev('a1')));
    expect(evidenceTextPath(ev('a1'), files, detail)).toBe('p/x.txt');
  });
});
