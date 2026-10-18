import { describe, expect, it } from 'vitest';
import { jobsConflict, refsConflict } from '../../src/core/model/job-conflict';
import type { Job } from '../../src/core/types/job';

const k = (type: Job['type'], noticeNo: string, round?: string, noticeId?: string) => ({ type, ref: { noticeNo, round, origin: 'g2b' as const }, noticeId });

describe('refsConflict', () => {
  it('X(round 없음)와 X-000은 충돌', () => {
    expect(refsConflict({ noticeNo: 'X' }, { noticeNo: 'X', round: '000' })).toBe(true);
  });
  it('X-000과 X-001은 비충돌', () => {
    expect(refsConflict({ noticeNo: 'X', round: '000' }, { noticeNo: 'X', round: '001' })).toBe(false);
  });
  it('다른 공고번호는 비충돌', () => {
    expect(refsConflict({ noticeNo: 'X' }, { noticeNo: 'Y' })).toBe(false);
  });
});

describe('jobsConflict', () => {
  it('collect와 download_retry/extract는 같은 군이라 충돌', () => {
    expect(jobsConflict(k('collect', 'X'), k('download_retry', 'X', '000'))).toBe(true);
    expect(jobsConflict(k('collect', 'X'), k('extract', 'X'))).toBe(true);
  });
  it('collect vs compose는 같은 공고여도 비충돌', () => {
    expect(jobsConflict(k('collect', 'X'), k('compose', 'X'))).toBe(false);
  });
  it('ref가 없어도 noticeId가 같으면 충돌', () => {
    expect(jobsConflict({ type: 'collect', noticeId: 'N-000' }, { type: 'collect', noticeId: 'N-000' })).toBe(true);
  });
});

describe('jobsConflict 공고 식별 정규화', () => {
  it('collect(ref round 없음, X-00)와 extract(X-000, ref 없음)는 충돌', () => {
    expect(jobsConflict({ type: 'collect', ref: { noticeNo: 'X', origin: 'g2b' }, noticeId: 'X-00' }, { type: 'extract', noticeId: 'X-000' })).toBe(true);
  });
  it('X-001과 X-000은 비충돌', () => {
    expect(jobsConflict({ type: 'extract', noticeId: 'X-001' }, { type: 'extract', noticeId: 'X-000' })).toBe(false);
  });
  it("round '1'과 '001'은 충돌", () => {
    expect(jobsConflict({ type: 'collect', ref: { noticeNo: 'X', round: '1', origin: 'g2b' } }, { type: 'collect', ref: { noticeNo: 'X', round: '001', origin: 'g2b' } })).toBe(true);
  });
  it("'0001'과 '001', 'a1'과 'A1'은 충돌, '000'은 '00'과 구분", () => {
    const c = (a: string, b: string) => jobsConflict({ type: 'collect', ref: { noticeNo: 'X', round: a, origin: 'g2b' } }, { type: 'collect', ref: { noticeNo: 'X', round: b, origin: 'g2b' } });
    expect(c('0001', '001')).toBe(true);
    expect(c('a1', 'A1')).toBe(true);
    expect(c('000', '001')).toBe(false);
  });
});
