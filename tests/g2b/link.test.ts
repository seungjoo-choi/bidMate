import { describe, expect, it } from 'vitest';
import { COLLECTIBLE_KINDS, linkToNoticeRef, parseG2bLink } from '../../src/adapters/g2b/link';

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
  it('수집 가능 종류는 bid뿐', () => {
    expect([...COLLECTIBLE_KINDS]).toEqual(['bid']);
  });
});

describe('linkToNoticeRef', () => {
  it('bid만 반환', () => {
    expect(linkToNoticeRef(parseG2bLink(BID)!, 'trackerbot')).toEqual({ noticeNo: 'R26BK01722175', round: '000', detailUrl: BID, origin: 'trackerbot' });
    expect(linkToNoticeRef(parseG2bLink(PRE)!, 'trackerbot')).toBeNull();
    expect(linkToNoticeRef(parseG2bLink(PLAN)!, 'trackerbot')).toBeNull();
  });
  it('round 없으면 키 생략', () => {
    const r = linkToNoticeRef(parseG2bLink('https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175')!, 'g2b');
    expect(r).not.toHaveProperty('round');
  });
});
