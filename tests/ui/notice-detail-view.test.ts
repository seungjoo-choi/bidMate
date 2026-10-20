import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { Attachment, Notice } from '../../src/core/types/notice';
import type { Extraction } from '../../src/core/types/extraction';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { Job } from '../../src/core/types/job';
import type { MailDraft } from '../../src/core/types/mail';
import {
  deadlineNoticeView, overviewStats, scheduleTimeline,
  attachmentPath, attachmentRows, attachmentSummary, detailTabs, effectiveTab, folderRelPath, mailSummary,
  overviewGroups, relatedNotices, resultMilestones, sessionJobRows,
} from '../../src/ui/notice-detail/view';

const NOW = '2026-10-19T00:00:00.000Z';
const bid = (id = 'N1-000'): Notice => emptyNotice(id, { noticeNo: 'N1', round: '000', origin: 'manual' }, 'notices/N1-000', NOW);
const prespec = (): Notice => emptyNotice('R1', { kind: 'prespec', noticeNo: 'R1', origin: 'manual' }, 'notices/R1', NOW);
const att = (p: Partial<Attachment>): Attachment => ({
  id: 'a', index: 0, originalName: 'a.pdf', savedName: 'a.pdf', url: '', expectedSize: 100, savedSize: 100, status: 'saved', attempts: 1, ...p,
});
const entry = (p: Partial<IndexEntry>): IndexEntry => ({
  noticeId: 'N1-000', noticeNo: 'N1', round: '000', title: 't', orderingOrg: 'o', folder: 'f', collectedAt: NOW, collectStatus: 'collected',
  attachments: { total: 0, saved: 0, failed: 0 }, extractionStatus: 'none' as IndexEntry['extractionStatus'], mailStatus: 'none', isCorrection: false, ...p,
});

describe('overviewGroups', () => {
  it('bid는 일정 그룹 있고 prespec은 없음', () => {
    expect(overviewGroups(bid(), []).some((g) => g.id === 'schedule')).toBe(true);
    expect(overviewGroups(prespec(), []).some((g) => g.id === 'schedule')).toBe(false);
  });
  it('needs_review mark, null은 대시', () => {
    const n = bid();
    n.basic.awardMethod = { value: '적격심사', status: 'needs_review' };
    const rows = overviewGroups(n, []).flatMap((g) => g.rows);
    expect(rows.find((r) => r.label === '낙찰자 결정방법')).toMatchObject({ value: '적격심사', mark: 'needs_review' });
    expect(rows.find((r) => r.label === '사업예산')?.value).toBe('—');
  });
  it('customFields 비면 그룹 없음', () => {
    const n = bid();
    expect(overviewGroups(n, []).some((g) => g.id === 'custom')).toBe(false);
    n.customFields = { 비고: { value: 'x', status: 'verified' } };
    expect(overviewGroups(n, []).find((g) => g.id === 'custom')?.rows[0]).toMatchObject({ label: '비고', value: 'x' });
  });
  it('prespec relatedBidNo가 index에 있으면 href', () => {
    const n = prespec();
    n.prespec.relatedBidNo = { value: 'N1', status: 'verified' };
    const r = overviewGroups(n, [entry({})])[0]!.rows.find((x) => x.label === '연계 입찰공고번호');
    expect(r?.href).toBe('#/notices/N1-000');
    expect(overviewGroups(n, [])[0]!.rows.find((x) => x.label === '연계 입찰공고번호')?.href).toBeUndefined();
  });
});

describe('attachments', () => {
  it('rows와 summary', () => {
    const n = bid();
    n.attachments = [
      att({ id: '1', index: 0 }),
      att({ id: '2', index: 1, originalName: 'b.hwp', savedName: 'b.hwp' }),
      att({ id: '3', index: 2, status: 'failed', savedName: null, savedSize: null }),
      att({ id: '4', index: 3, status: 'size_mismatch', savedSize: 50, expectedSize: 2048 }),
      att({ id: '5', index: 4, status: 'skipped', savedName: null }),
    ];
    const rows = attachmentRows(n);
    expect(rows.map((r) => r.openable)).toEqual([true, false, false, true, false]);
    expect(rows[3]!.size).toBe('저장 50 B / 예상 2.0 KB');
    expect(attachmentSummary(n)).toEqual({ total: 5, saved: 2, failed: 2, skipped: 1 });
  });
  it('prespec origin은 종류 앞에 사전규격 표시하고 origin 전달, 중복 행은 건너뜀과 비고', () => {
    const n = bid();
    n.attachments = [
      att({ id: '1', index: 0, docKind: 'rfp' }),
      att({ id: '2', index: 1, origin: 'prespec', docKind: 'rfp' }),
      att({ id: '3', index: 2, origin: 'prespec', status: 'skipped', savedName: null, duplicateOf: '1', note: '입찰공고 첨부와 중복(사전규격)' }),
    ];
    const rows = attachmentRows(n);
    expect(rows[0]!.kind).not.toContain('사전규격');
    expect(rows[0]!.origin).toBeUndefined();
    expect(rows[1]!.kind).toBe(`사전규격 / ${rows[0]!.kind}`);
    expect(rows[1]!.origin).toBe('prespec');
    expect(rows[2]).toMatchObject({ status: 'skipped', remark: '입찰공고 첨부와 중복(사전규격)' });
  });
  it('attachmentPath와 folderRelPath', () => {
    expect(attachmentPath('notices/N1', 'a.pdf')).toEqual(['notices', 'N1', 'attachments', 'a.pdf']);
    expect(attachmentPath('N1', 'a.pdf')).toEqual(['notices', 'N1', 'attachments', 'a.pdf']);
    expect(() => attachmentPath('N1', '../a.pdf')).toThrow();
    expect(() => attachmentPath('N1', 'x/a.pdf')).toThrow();
    expect(folderRelPath('notices\\2026\\N1')).toBe('notices/2026/N1');
    expect(folderRelPath('2026/N1')).toBe('notices/2026/N1');
  });
});

describe('relatedNotices', () => {
  it('같은 번호 다른 차수 정렬, current, 다른 kind 제외, supersededBy', () => {
    const n = bid('N1-001');
    const idx = [
      entry({ noticeId: 'N1-001', round: '001', supersededBy: 'N1-002' }),
      entry({ noticeId: 'N1-000', round: '000' }),
      entry({ noticeId: 'N1-002', round: '002' }),
      entry({ noticeId: 'N1', kind: 'prespec', round: '' }),
    ];
    const r = relatedNotices(n, idx);
    expect(r.rounds.map((x) => x.noticeId)).toEqual(['N1-000', 'N1-001', 'N1-002']);
    expect(r.rounds.filter((x) => x.current).map((x) => x.noticeId)).toEqual(['N1-001']);
    expect(r.supersededBy).toBe('N1-002');
  });
});

describe('relatedNotices noticeNo 규칙', () => {
  it('basic.noticeNo가 빈 문자열이면 ref.noticeNo', () => {
    const n = bid('N1-001');
    n.basic.noticeNo = { value: '', status: 'missing' };
    const r = relatedNotices(n, [entry({ noticeId: 'N1-001', round: '001' })]);
    expect(r.rounds.map((x) => x.noticeId)).toEqual(['N1-001']);
  });
});

describe('mail, jobs, tabs', () => {
  it('mailSummary', () => {
    const n = bid();
    expect(mailSummary(n, null).draft).toBeNull();
    const d = { preparedAt: NOW, subject: 's', to: ['a'], cc: [], attachments: [{}], skippedAttachments: [{}], excludedAttachments: [{}] } as unknown as MailDraft;
    expect(mailSummary(n, d).draft).toMatchObject({ subject: 's', to: 1, cc: 0, attachments: 1, skipped: 2, editedAt: null });
  });
  it('sessionJobRows', () => {
    const j = (id: string, noticeId: string, createdAt: string): Job => ({
      id, type: 'collect', noticeId, status: 'completed', steps: [], attempt: 1, createdAt, updatedAt: createdAt, errors: [],
    });
    const rows = sessionJobRows([j('a', 'N1', '2026-10-19T01:00:00.000Z'), j('b', 'X', NOW), j('c', 'N1', '2026-10-19T02:00:00.000Z')], 'N1');
    expect(rows.map((r) => r.id)).toEqual(['c', 'a']);
    expect(rows[0]).toMatchObject({ type: '수집', status: '완료' });
  });
  it('detailTabs/effectiveTab', () => {
    expect(detailTabs(bid(), null).map((t) => t.id)).toEqual(['overview', 'files', 'history', 'review']);
    expect(detailTabs(bid(), null).find((t) => t.id === 'review')).toMatchObject({ label: '공고정보 검토', count: 9 });
    expect(detailTabs(prespec(), null).some((t) => t.id === 'review')).toBe(false);
    expect(effectiveTab('review', prespec())).toBe('overview');
    expect(effectiveTab('review', bid())).toBe('review');
  });
});

describe('overviewStats, scheduleTimeline', () => {
  const now = new Date('2026-10-20T03:00:00.000Z');
  const withSchedule = (): Notice => {
    const n = bid();
    n.basic.budgetAmount = { ...n.basic.budgetAmount, value: 1_923_000_000 };
    n.schedule.bidStartAt = { ...n.schedule.bidStartAt, value: '2026-10-15T01:00:00.000Z' };
    n.schedule.bidCloseAt = { ...n.schedule.bidCloseAt, value: '2026-10-22T05:00:00.000Z' };
    n.schedule.openingAt = { ...n.schedule.openingAt, value: '2026-10-22T06:00:00.000Z', status: 'needs_review' };
    return n;
  };

  it('입찰공고 요약 칸 4개, 금액은 억/만 표기와 콤마 병기, 값 없으면 —', () => {
    const s = overviewStats(withSchedule(), now);
    expect(s.map((x) => x.label)).toEqual(['사업예산', '추정가격', '입찰 마감', '개찰']);
    expect(s[0]).toMatchObject({ value: '19억 2,300만 원', sub: '1,923,000,000 원' });
    expect(s[1]).toEqual({ label: '추정가격', value: '—' });
    expect(s[2]!.value).toBe('D-2');
    expect(s[2]!.tone).toBe('warn');
  });

  it('마감이 지나면 마감됨, muted', () => {
    const s = overviewStats(withSchedule(), new Date('2026-10-23T00:00:00.000Z'));
    expect(s[2]).toMatchObject({ value: '마감됨', tone: 'muted' });
  });

  it('사전규격 요약 칸은 배정예산부터', () => {
    expect(overviewStats(prespec(), now)[0]!.label).toBe('배정예산');
  });

  it('타임라인은 값 있는 지점만 시간순, 지난 지점 done, 첫 미래 지점만 next', () => {
    const t = scheduleTimeline(withSchedule(), now);
    expect(t.map((m) => [m.key, m.state])).toEqual([
      ['bidStartAt', 'done'], ['bidCloseAt', 'next'], ['openingAt', 'upcoming'],
    ]);
    expect(t[0]!.dday).toBeNull();
    expect(t[1]!.dday).toBe('D-2');
    expect(t[2]!.mark).toBe('needs_review');
  });

  it('일정이 하나도 없으면 빈 배열', () => {
    expect(scheduleTimeline(bid(), now)).toEqual([]);
  });
});

describe('개요 행 추출 설명', () => {
  it('값이 비어도 note와 raw를 보여주고 검토 탭으로 연결한다', () => {
    const n = bid();
    n.evaluation.credibilityScore = { value: null, raw: '가점 6항목, 감점 2항목', status: 'needs_review', note: '가감점 표만 있음, 합계 배점 없음' };
    const ev = overviewGroups(n, []).find((g) => g.id === 'evaluation')!;
    const r = ev.rows.find((x) => x.label === '대외신인도 배점')!;
    expect(r).toMatchObject({ value: '가감점 표만 있음, 합계 배점 없음', hint: '가점 6항목, 감점 2항목', mark: 'needs_review', href: '#/notices/N1-000/review' });
  });
  it('경영상태가 충족이면 대외신인도 확인 필요를 떼고 충족 사유를 붙인다', () => {
    const n = bid();
    n.evaluation.credibilityScore = { value: null, raw: '가점 6항목, 감점 2항목', status: 'needs_review', note: '가감점 표만 있음, 합계 배점 없음' };
    const x = { items: {
      credibilityScore: { value: null, status: 'needs_review', reason: 'no_total' },
      managementScore: { value: 4, status: 'verified' },
    } } as unknown as Extraction;
    const r = overviewGroups(n, [], x).find((g) => g.id === 'evaluation')!.rows.find((y) => y.label === '대외신인도 배점')!;
    expect(r.mark).toBeUndefined();
    expect(r.href).toBeUndefined();
    expect(r.hint).toBe('가점 6항목, 감점 2항목 (경영상태 배점으로 충족)');
  });
  it('설명이 없으면 그대로 —, 링크 없음', () => {
    const r = overviewGroups(bid(), []).find((g) => g.id === 'evaluation')!.rows.find((x) => x.label === '대외신인도 배점')!;
    expect(r.value).toBe('—');
    expect(r.href).toBeUndefined();
  });
});


describe('deadlineNoticeView', () => {
  const on = { notify: { rank: true, final: true, deadline: true } };
  const delivered = (): Notice => {
    const n = bid();
    n.mail.status = 'delivered';
    n.schedule.bidCloseAt = { value: '2026-10-22T14:00:00+09:00', status: 'verified' };
    return n;
  };
  const now = new Date('2026-10-20T03:00:00Z'); // 10-20 12:00 KST

  it('설정이 꺼져 있으면 off', () => {
    expect(deadlineNoticeView(delivered(), [], { notify: { ...on.notify, deadline: false } }, now)).toEqual({ state: 'off' });
  });
  it('사전규격, 전달 전, 더 큰 round, 일정 없음은 not_target', () => {
    expect(deadlineNoticeView(prespec(), [], on, now)).toMatchObject({ state: 'not_target', reason: '사전규격은 마감 알림 대상이 아닙니다' });
    const none = delivered();
    none.mail.status = 'none';
    expect(deadlineNoticeView(none, [], on, now)).toMatchObject({ state: 'not_target', reason: '메일 전달을 마쳤거나 팔로우한 공고만 알림을 보냅니다' });
    expect(deadlineNoticeView(none, [entry({ noticeId: none.id, following: 'final' })], on, now).state).toBe('target');
    expect(deadlineNoticeView(delivered(), [entry({ noticeId: 'N1-001', round: '001' })], on, now)).toMatchObject({ state: 'not_target', reason: '더 새로운 차수의 공고가 대상입니다' });
    const empty = delivered();
    empty.schedule.bidCloseAt = { value: null, status: 'missing' };
    expect(deadlineNoticeView(empty, [], on, now)).toMatchObject({ state: 'not_target', reason: '공고정보에 마감 일정이 없습니다' });
  });
  it('target은 지난 시각을 빼고 라인을 만든다', () => {
    const n = delivered();
    n.schedule.registrationDeadline = { value: '2026-10-21T10:00:00+09:00', status: 'verified' };
    expect(deadlineNoticeView(n, [], on, now)).toEqual({
      state: 'target',
      lines: [
        { label: '입찰 마감', times: ['D-1 10/21 09:00', '당일 10/22 09:00'] },
        { label: '참가등록 마감', times: ['당일 10/21 09:00'] },
      ],
    });
  });
  it('모든 시각이 지나면 lines가 비어 있다', () => {
    expect(deadlineNoticeView(delivered(), [], on, new Date('2026-10-22T03:00:00Z'))).toEqual({ state: 'target', lines: [] });
  });
});


describe('resultMilestones', () => {
  const now = new Date('2026-10-21T12:00:00+09:00');
  const done = [{ key: 'a', label: 'a', when: '', dday: null, state: 'done' as const }];
  const pending = [{ key: 'a', label: 'a', when: '', dday: null, state: 'next' as const }];
  it('팔로우도 결과도 없으면 빈 배열', () => {
    expect(resultMilestones({}, done, now)).toEqual([]);
  });
  it('낙찰까지 팔로우, 확인 시작 전', () => {
    const m = resultMilestones({ following: 'final', result: { status: 'waiting', startAt: '2026-11-05T14:00:00+09:00' } as never }, done, now);
    expect(m.map((x) => [x.key, x.state])).toEqual([['rank', 'upcoming'], ['final', 'upcoming']]);
    expect(m[0]!.when).toMatch(/부터 확인$/);
  });
  it('확인 중이면 순위 발표가 다음 단계, 앞 일정에 다음 단계가 있으면 강조하지 않음', () => {
    const r = { following: 'final' as const, result: { status: 'waiting', startAt: '2026-10-20T14:00:00+09:00' } as never };
    expect(resultMilestones(r, done, now)[0]!.state).toBe('next');
    expect(resultMilestones(r, pending, now)[0]!.state).toBe('upcoming');
  });
  it('순위 확인, 개찰 결과만은 최종 결과 단계 없음', () => {
    const m = resultMilestones({ following: 'rank', result: { status: 'ranked', rank: 2, bidders: 5 } as never }, done, now);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ state: 'done', when: '우리 2위 / 5개사' });
  });
  it('결과 확정이면 팔로우가 없어도 표시', () => {
    const m = resultMilestones({ result: { status: 'won', rank: 1 } as never }, done, now);
    expect(m.map((x) => [x.key, x.state, x.when])).toEqual([['rank', 'done', '우리 1위'], ['final', 'done', '낙찰']]);
  });
});
