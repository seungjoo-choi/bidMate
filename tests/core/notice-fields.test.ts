import { describe, expect, it } from 'vitest';
import { PRESPEC_KEYS, emptyNotice, fillMissingFields, getField, setFields } from '../../src/core/model/notice-fields';
import type { Notice } from '../../src/core/types/notice';

describe('notice-fields prespec', () => {
  it('emptyNotice는 prespec을 전부 missing으로 채운다', () => {
    const n = emptyNotice('R1', { kind: 'prespec', noticeNo: 'R1', origin: 'manual' }, 'f', 'x');
    for (const k of PRESPEC_KEYS) expect(n.prespec[k].status).toBe('missing');
  });
  it('옛 notice.json(prespec 없음)은 fillMissingFields가 보충한다', () => {
    const n = emptyNotice('A-00', { noticeNo: 'A', origin: 'manual' }, 'f', 'x');
    delete (n as Partial<Notice>).prespec;
    fillMissingFields(n);
    for (const k of PRESPEC_KEYS) expect(n.prespec[k].status).toBe('missing');
  });
  it('setFields/getField가 prespec 그룹을 다룬다', () => {
    const n = emptyNotice('R1', { kind: 'prespec', noticeNo: 'R1', origin: 'manual' }, 'f', 'x');
    setFields(n, { specName: { value: '사업', status: 'verified' } });
    expect(n.prespec.specName.value).toBe('사업');
    expect(getField(n, 'specName')?.value).toBe('사업');
  });
});
