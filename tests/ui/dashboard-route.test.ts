import { describe, expect, it } from 'vitest';
import { evaluationHash, noticeHash, parseRoute } from '../../src/entrypoints/dashboard/route';

describe('parseRoute 발송 이력', () => {
  it('#/mails', () => {
    expect(parseRoute('#/mails')).toEqual({ page: 'mails', tab: 'drafts' });
    expect(parseRoute('#/mails/sent')).toEqual({ page: 'mails', tab: 'sent' });
    expect(parseRoute('#/sent')).toEqual({ page: 'mails', tab: 'sent' });
  });
});

describe('parseRoute 공고 상세', () => {
  const enc = encodeURIComponent('N-001');
  it('탭 없으면 overview', () => {
    expect(parseRoute(`#/notices/${enc}`)).toEqual({ page: 'notice', noticeId: 'N-001', tab: 'overview', query: {} });
  });
  it('지정 탭', () => {
    expect(parseRoute(`#/notices/${enc}/files`)).toMatchObject({ page: 'notice', tab: 'files' });
  });
  it('모르는 탭은 overview', () => {
    expect(parseRoute(`#/notices/${enc}/zzz`)).toMatchObject({ page: 'notice', tab: 'overview' });
  });
  it('review 탭과 query', () => {
    expect(parseRoute(`#/notices/${enc}/review?handoff=needs_review`)).toEqual({
      page: 'notice', noticeId: 'N-001', tab: 'review', query: { handoff: 'needs_review' },
    });
  });
  it('#/review 별칭', () => {
    expect(parseRoute(`#/review/${enc}?handoff=a,b`)).toEqual({ page: 'notice', noticeId: 'N-001', tab: 'review', query: { handoff: 'a,b' } });
  });
  it('#/notices는 목록', () => {
    expect(parseRoute('#/notices')).toEqual({ page: 'notices' });
  });
  it('잘못된 인코딩은 home', () => {
    expect(parseRoute('#/notices/%E0%A4%A')).toEqual({ page: 'home' });
  });
});

describe('noticeHash', () => {
  it('overview는 탭 세그먼트 없음', () => {
    expect(noticeHash('N-001')).toBe('#/notices/N-001');
    expect(noticeHash('N-001', 'overview')).toBe('#/notices/N-001');
    expect(noticeHash('N-001', 'files')).toBe('#/notices/N-001/files');
  });
  it('특수문자 id 왕복', () => {
    const id = 'a/b c?d#e';
    expect(parseRoute(noticeHash(id, 'history'))).toMatchObject({ page: 'notice', noticeId: id, tab: 'history' });
    expect(parseRoute(noticeHash(id))).toMatchObject({ noticeId: id, tab: 'overview' });
  });
  it('query 왕복', () => {
    const h = noticeHash('N-001', 'files', { handoff: 'a,b' });
    expect(parseRoute(h)).toEqual({ page: 'notice', noticeId: 'N-001', tab: 'files', query: { handoff: 'a,b' } });
    expect(noticeHash('N-001', 'overview', {})).toBe('#/notices/N-001');
  });
});

describe('parseRoute 평가분석', () => {
  it('목록과 상세', () => {
    expect(parseRoute('#/evaluations')).toEqual({ page: 'evaluations' });
    expect(parseRoute('#/evaluations/')).toEqual({ page: 'evaluations' });
    expect(parseRoute('#/evaluations/R26BK01631407-000')).toEqual({ page: 'evaluation', noticeId: 'R26BK01631407-000' });
    expect(parseRoute(evaluationHash('a/b c'))).toEqual({ page: 'evaluation', noticeId: 'a/b c' });
  });
});
