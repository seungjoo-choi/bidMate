import { describe, expect, it } from 'vitest';
import { kindOf, noticeId, noticeIdOf, noticeLabel } from '../../src/core/model/ids';

describe('ids', () => {
  it('kindOf: 없음 = bid', () => {
    expect(kindOf(undefined)).toBe('bid');
    expect(kindOf({})).toBe('bid');
    expect(kindOf({ kind: 'prespec' })).toBe('prespec');
  });
  it('noticeIdOf: bid는 기존 noticeId, prespec/orderplan은 번호 그대로', () => {
    expect(noticeIdOf({ noticeNo: 'R26BK1', round: '001' })).toBe(noticeId('R26BK1', '001'));
    expect(noticeIdOf({ noticeNo: 'R26BK1' })).toBe('R26BK1-00');
    expect(noticeIdOf({ kind: 'prespec', noticeNo: 'R26BD00273952' })).toBe('R26BD00273952');
    expect(noticeIdOf({ kind: 'orderplan', noticeNo: 'P1', round: '001' })).toBe('P1');
  });
  it('noticeLabel: bid는 번호-차수, 그 외 번호', () => {
    expect(noticeLabel({ noticeNo: 'R26BK1', round: '001' })).toBe('R26BK1-001');
    expect(noticeLabel({ kind: 'prespec', noticeNo: 'R26BD00273952', round: '' })).toBe('R26BD00273952');
  });
});
