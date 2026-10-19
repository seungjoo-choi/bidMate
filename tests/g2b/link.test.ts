import { describe, expect, it } from 'vitest';
import { COLLECTIBLE_KINDS, detailUrlOf, linkToNoticeRef, sameRound, parseG2bLink } from '../../src/adapters/g2b/link';

const BID = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000';
const PRE = 'https://www.g2b.go.kr/link/PRVA004_02/single/?bfSpecRegNo=R26BD00273952';
const PLAN = 'https://www.g2b.go.kr/link/PRPA015_01/single/?oderPlanNo=R26DD20869346';

describe('parseG2bLink', () => {
  it('세 형식', () => {
    expect(parseG2bLink(BID)).toEqual({ kind: 'bid', id: 'R26BK01722175', round: '000', url: BID });
    expect(parseG2bLink(PRE)).toEqual({ kind: 'prespec', id: 'R26BD00273952', url: PRE });
    expect(parseG2bLink(PLAN)).toEqual({ kind: 'orderplan', id: 'R26DD20869346', url: PLAN });
  });
  it('다른 호스트/http -> null', () => {
    expect(parseG2bLink(BID.replace('www.g2b.go.kr', 'evil.example'))).toBeNull();
    expect(parseG2bLink(BID.replace('https:', 'http:'))).toBeNull();
    expect(parseG2bLink('not a url')).toBeNull();
  });
  it('id 형식 오류 -> null', () => {
    expect(parseG2bLink(BID.replace('R26BK01722175', 'X123'))).toBeNull();
  });
  it('차수 0 -> 000, 없음 -> undefined', () => {
    expect(parseG2bLink(BID.replace('bidPbancOrd=000', 'bidPbancOrd=0'))?.round).toBe('000');
    const l = parseG2bLink('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175');
    expect(l?.round).toBeUndefined();
    expect(l?.url).toBe('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175');
  });
  it('추가 쿼리/해시 제거', () => {
    expect(parseG2bLink(`${BID}&x=1#frag`)?.url).toBe(BID);
  });
  it('수집 가능 종류는 bid, prespec', () => {
    expect([...COLLECTIBLE_KINDS]).toEqual(['bid', 'prespec']);
  });
});

describe('linkToNoticeRef', () => {
  it('bid(kind 생략)와 prespec 반환, orderplan은 null', () => {
    const bid = linkToNoticeRef(parseG2bLink(BID)!, 'trackerbot');
    expect(bid).toEqual({ noticeNo: 'R26BK01722175', round: '000', detailUrl: BID, origin: 'trackerbot' });
    expect(bid).not.toHaveProperty('kind');
    const pre = linkToNoticeRef(parseG2bLink(PRE)!, 'trackerbot');
    expect(pre).toEqual({ kind: 'prespec', noticeNo: 'R26BD00273952', detailUrl: PRE, origin: 'trackerbot' });
    expect(pre).not.toHaveProperty('round');
    expect(linkToNoticeRef(parseG2bLink(PLAN)!, 'trackerbot')).toBeNull();
  });
  it('round 없으면 키 생략', () => {
    const r = linkToNoticeRef(parseG2bLink('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175')!, 'g2b');
    expect(r).not.toHaveProperty('round');
  });
});

describe('detailUrlOf', () => {
  it('detailUrl이 있는 bid는 정규화 URL', () => {
    expect(detailUrlOf({ noticeNo: 'R26BK01722175', detailUrl: 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancOrd=0&bidPbancNo=R26BK01722175' })).toBe(BID);
  });
  it('번호+round면 생성 URL', () => {
    expect(detailUrlOf({ noticeNo: 'R26BK01722175', round: '000' })).toBe(BID);
  });
  it('round 없으면 ord 생략', () => {
    expect(detailUrlOf({ noticeNo: 'R26BK01722175' })).toBe('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175');
  });
  it('prespec/orderplan kind는 null', () => {
    expect(detailUrlOf({ kind: 'prespec', noticeNo: 'R26BD00273952', detailUrl: PRE })).toBeNull();
    expect(detailUrlOf({ kind: 'orderplan', noticeNo: 'R26DD20869346' })).toBeNull();
  });
  it('비g2b detailUrl은 생성 URL로 대체', () => {
    expect(detailUrlOf({ noticeNo: 'R26BK01722175', round: '000', detailUrl: 'https://evil.example.com/?bidPbancNo=R26BK01722175' })).toBe(BID);
  });
});

describe('sameRound', () => {
  it('앞 0을 제거해 비교', () => {
    expect(sameRound('1', '001')).toBe(true);
    expect(sameRound('000', '0')).toBe(true);
    expect(sameRound('001', '002')).toBe(false);
  });
});

describe('detailUrlOf 공고번호 불일치', () => {
  it('detailUrl의 공고번호가 ref.noticeNo와 다르면 생성 URL', () => {
    expect(detailUrlOf({ noticeNo: 'R26BK01722175', round: '000', detailUrl: 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK09999999&bidPbancOrd=000' })).toBe(BID);
  });
});
