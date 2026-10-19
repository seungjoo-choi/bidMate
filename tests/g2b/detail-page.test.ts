// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import html from '../fixtures/g2b-detail.html?raw';
import { detectDetail, readHtmlFields, readPageTitle } from '../../src/adapters/g2b/detail-page';

// jsdom은 offsetParent가 항상 null이라 display:none 조상 여부로 판정한다.
const isVisible = (el: Element) => !el.closest('[style*="display:none"], [style*="display: none"]');
const opts = { isVisible, url: 'https://www.g2b.go.kr/' };

beforeEach(() => { document.documentElement.innerHTML = html; });

const setNoValue = () => { document.querySelector<HTMLInputElement>('input[title="입찰공고번호"]')!.value = ''; };

describe('detectDetail', () => {
  it('입찰공고번호 value를 파싱한다', () => {
    expect(detectDetail(document, opts)).toEqual({ noticeNo: 'R26BK01722175', round: '000' });
  });
  it('value가 비어 있으면 URL fallback', () => {
    setNoValue();
    const url = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000';
    expect(detectDetail(document, { ...opts, url })).toEqual({ noticeNo: 'R26BK01722175', round: '000' });
  });
  it('value도 URL도 없으면 null', () => {
    setNoValue();
    expect(detectDetail(document, opts)).toBeNull();
  });
  it('URL의 bidPbancNo가 형식에 맞지 않으면 null', () => {
    setNoValue();
    expect(detectDetail(document, { ...opts, url: 'https://www.g2b.go.kr/?bidPbancNo=abc' })).toBeNull();
  });
  it('mainWframe이 없으면 null', () => {
    document.body.innerHTML = '';
    expect(detectDetail(document, opts)).toBeNull();
  });
  it('숨은 중복 input은 무시한다', () => {
    document.querySelector<HTMLInputElement>('input[title="입찰공고번호"]')!.value = '';
    expect(detectDetail(document, opts)).toBeNull(); // 숨은 input의 값(R99...)을 쓰지 않는다
  });
});

describe('readHtmlFields', () => {
  const r = () => readHtmlFields(document, { ...opts, now: new Date('2026-10-17T00:00:00Z') });

  it('eligibility 형식', () => {
    expect(r().fields.eligibility).toEqual({ raw: '투찰가능: - / 허용: 공고서참조', ref: 'grid:grdLcnsLmt' });
  });
  it('여러 행은 "; "로 잇는다', () => {
    document.querySelector('#mf_wfm_container_mainWframe_grdLcnsLmt_body_table tbody')!
      .insertAdjacentHTML('beforeend', '<tr><td>2</td><td>소프트웨어사업자</td><td>-</td></tr>');
    expect(r().fields.eligibility!.raw).toBe('투찰가능: - / 허용: 공고서참조; 투찰가능: 소프트웨어사업자 / 허용: -');
  });
  it('헤더(_head_table)를 못 찾으면 eligibility를 생략한다', () => {
    document.querySelector('#mf_wfm_container_mainWframe_grdLcnsLmt_head_table')!.remove();
    expect(r().fields.eligibility).toBeUndefined();
  });
  it('보이지 않는 행은 건너뛴다', () => {
    document.querySelector('#mf_wfm_container_mainWframe_grdLcnsLmt_body_table tbody')!
      .insertAdjacentHTML('beforeend', '<tr style="display:none"><td>2</td><td>숨은업종</td><td>-</td></tr>');
    expect(r().fields.eligibility!.raw).toBe('투찰가능: - / 허용: 공고서참조');
  });
  it('proposalPeriod: 공백 2칸 title 매칭, 숨은 중복 무시', () => {
    expect(r().fields.proposalPeriod).toEqual({
      raw: '2026/10/22 09:00:00 ~ 2026/10/30 18:00:00', ref: 'title=최종제안서 제출시작일시|마감일시',
    });
  });
  it('proposalPeriod: 하나만 있으면 그 값만', () => {
    document.querySelector<HTMLInputElement>('input[title="최종제안서  제출마감일시"]')!.value = '';
    expect(r().fields.proposalPeriod!.raw).toBe('2026/10/22 09:00:00');
  });
  it('proposalPeriod: 입력칸이 숨겨져 있으면 gridList1 제출 행', () => {
    document.querySelectorAll('input[title^="최종제안서"]').forEach((el) => el.closest('div')!.setAttribute('style', 'display:none'));
    document.querySelector('#mf_wfm_container_mainWframe_gridList1_body_table tbody')!
      .insertAdjacentHTML('beforeend', '<tr><td>3</td><td>제안서 제출</td><td></td><td>2026/10/15 10:00:00</td><td>2026/10/22 14:00:00</td><td>나라장터</td></tr>');
    expect(r().fields.proposalPeriod).toEqual({ raw: '2026/10/15 10:00:00 ~ 2026/10/22 14:00:00', ref: 'grid:gridList1' });
  });
  it('proposalPeriod: 입력칸도 제출 행도 없으면 생략', () => {
    document.querySelectorAll('input[title^="최종제안서"]').forEach((el) => el.closest('div')!.setAttribute('style', 'display:none'));
    expect(r().fields.proposalPeriod).toBeUndefined();
  });
  it('proposalEvalAt: 제안서발표 셀 경로', () => {
    expect(r().fields.proposalEvalAt).toEqual({ raw: '2026/11/05 14:00:00', ref: 'cell:제안서발표' });
  });
  it('proposalEvalAt: 셀이 없으면 gridList1 경로', () => {
    document.querySelector('#mf_wfm_container_mainWframe_wq_uuid_4558')!.remove();
    expect(r().fields.proposalEvalAt).toEqual({ raw: '2026/11/06 10:00:00', ref: 'grid:gridList1' });
  });
  it('differentialScoring은 원문을 trim만 해서 둔다', () => {
    expect(r().fields.differentialScoring!.raw).toBe('0.5');
  });
  it('projectPeriod/빈 항목은 생략하고 pageTitle/capturedAt을 채운다', () => {
    const out = r();
    expect(out.fields.projectPeriod).toBeUndefined();
    expect(out.pageTitle).toContain('필리핀 카라바오');
    expect(out.capturedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(readPageTitle(document, opts)).toBe(out.pageTitle);
  });
  it('projectPeriod: 라벨 셀 다음 값을 읽는다', () => {
    document.querySelector('#mf_wfm_container_mainWframe_wq_uuid_4178 tbody')!
      .insertAdjacentHTML('beforeend', '<tr><th>사업기간</th><td>계약일로부터 90일</td></tr>');
    expect(r().fields.projectPeriod).toEqual({ raw: '계약일로부터 90일', ref: 'cell:사업기간' });
  });
  it('projectPeriod: 용역기간 라벨도 읽는다', () => {
    document.querySelector('#mf_wfm_container_mainWframe_wq_uuid_4178 tbody')!
      .insertAdjacentHTML('beforeend', '<tr><th>용역기간</th><td>계약일로부터 60일</td></tr>');
    expect(r().fields.projectPeriod).toEqual({ raw: '계약일로부터 60일', ref: 'cell:용역기간' });
  });
});
