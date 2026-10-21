import { describe, expect, it } from 'vitest';
import { parseReqId } from '../../../src/core/rfp/ids';

describe('parseReqId', () => {
  it('SFR-01 → 정규화 key, prefix, seq, raw', () => {
    const r = parseReqId('SFR-01')!;
    expect(r.key).toBe('SFR-001');
    expect(r.prefix).toBe('SFR');
    expect(r.seq).toBe(1);
    expect(r.raw).toBe('SFR-01');
  });
  it('전각 하이픈', () => {
    expect(parseReqId('PER－003')!.key).toBe('PER-003');
  });
  it('밑줄 구분', () => {
    expect(parseReqId('SER_2')!.key).toBe('SER-002');
  });
  it('하위 번호', () => {
    const r = parseReqId('SFR-001-2')!;
    expect(r.sub).toBe(2);
    expect(r.key).toBe('SFR-001-02');
  });
  it('번호 뒤 명칭은 rest', () => {
    expect(parseReqId('SFR-001 사용자 로그인')!.rest).toBe('사용자 로그인');
  });
  it('번호가 아닌 것은 null', () => {
    expect(parseReqId('ABC')).toBeNull();
    expect(parseReqId('SFR001')).toBeNull();
    expect(parseReqId('2025-01')).toBeNull();
  });
});
