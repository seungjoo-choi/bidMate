// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { scanG2bLinks } from '../../src/adapters/trackerbot/mail-scan';

const L = {
  plan: 'https://www.g2b.go.kr/link/PRPA015_01/single/?oderPlanNo=R26DD20869346',
  pre: 'https://www.g2b.go.kr/link/PRVA004_02/single/?bfSpecRegNo=R26BD00273952',
  bid: 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000',
};
const table = (head: string, rows: string) => `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
const row = (title: string, href: string) => `<tr><td>1</td><td>${title}</td><td><a href="${href}">바로가기</a></td></tr>`;
const H3 = '<th>번호</th><th>사업명</th><th>링크</th>';

beforeEach(() => { document.body.innerHTML = ''; });

describe('scanG2bLinks', () => {
  it('입찰정보·사전규격 앵커만 반환(발주계획 제외)', () => {
    document.body.innerHTML = table(H3, row('계획', L.plan)) + table(H3, row('사전', L.pre)) + table(H3, row('입찰', L.bid));
    const r = scanG2bLinks(document);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.link.kind)).toEqual(['prespec', 'bid']);
    expect(r[1]!.title).toBe('입찰');
  });
  it('사전규격 표(사업명|기관명|사업구분|링크): 앵커 포함, 제목 추출, 발주계획 제외', () => {
    const H4 = '<th>사업명</th><th>기관명</th><th>사업구분</th><th>링크</th>';
    const t = '우간다 지방정부 사업성과관리 향상을 위한 IT 역량강화 프로젝트봉사단 사업[2단계](26-29) PMC 용역';
    const r4 = (title: string, href: string) => `<tr><td>${title}</td><td>한국국제협력단</td><td>일반용역</td><td><a href="${href}">바로가기</a></td></tr>`;
    document.body.innerHTML = table(H4, r4(t, L.pre) + r4('계획', L.plan));
    const r = scanG2bLinks(document);
    expect(r).toHaveLength(1);
    expect(r[0]!.link).toMatchObject({ kind: 'prespec', id: 'R26BD00273952' });
    expect(r[0]!.title).toBe(t);
  });
  it('같은 공고 2행은 2건(키 동일)', () => {
    document.body.innerHTML = table(H3, row('취소', L.bid) + row('일반', L.bid));
    const r = scanG2bLinks(document);
    expect(r).toHaveLength(2);
    expect(r[0]!.link.id).toBe(r[1]!.link.id);
    expect(r[0]!.link.round).toBe(r[1]!.link.round);
  });
  it('줄바꿈 섞인 사업명 정규화', () => {
    document.body.innerHTML = table(H3, row('가나\n  다 \n라', L.bid));
    expect(scanG2bLinks(document)[0]!.title).toBe('가나 다 라');
  });
  it('contenteditable 안 복사본 제외', () => {
    document.body.innerHTML = `<div contenteditable="true">${table(H3, row('x', L.bid))}</div>`;
    expect(scanG2bLinks(document)).toHaveLength(0);
  });
  it('표 밖 링크 제외', () => {
    document.body.innerHTML = `<p><a href="${L.bid}">바로가기</a></p>`;
    expect(scanG2bLinks(document)).toHaveLength(0);
  });
  it('[data-bidmate] 내부 제외', () => {
    document.body.innerHTML = table(H3, `<tr><td>1</td><td>x</td><td><span data-bidmate="x"><a href="${L.bid}">바로가기</a></span></td></tr>`);
    expect(scanG2bLinks(document)).toHaveLength(0);
  });
  it('헤더/행 셀 수 불일치 시 title undefined', () => {
    document.body.innerHTML = table(H3, `<tr><td>x</td><td><a href="${L.bid}">바로가기</a></td></tr>`);
    const r = scanG2bLinks(document);
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBeUndefined();
  });
});
