import { describe, expect, it } from 'vitest';
import { parseHtmlField } from '../../src/adapters/g2b/html-parse';
import { mapApiItem } from '../../src/adapters/g2b/openapi';
import { parseJointVenture } from '../../src/core/model/joint-venture';

const p = (key: Parameters<typeof parseHtmlField>[0], raw: string) => parseHtmlField(key, raw, 'ref', '2026-10-17T00:00:00Z');

describe('html-parse', () => {
  it('날짜 3형식', () => {
    expect(p('bidCloseAt', '2026/10/21 18:00:00').value).toBe('2026-10-21T18:00:00+09:00');
    expect(p('bidCloseAt', '2026/10/21 18:00').value).toBe('2026-10-21T18:00:00+09:00');
    expect(p('bidCloseAt', '2026-10-21 18:00').value).toBe('2026-10-21T18:00:00+09:00');
    expect(p('bidCloseAt', '내일').status).toBe('needs_review');
  });
  it('금액', () => {
    expect(p('estimatedPrice', '1,923,000,000').value).toBe(1923000000);
    expect(p('estimatedPrice', '1,923,000,000원').value).toBe(1923000000);
    const mixed = p('estimatedPrice', '19억 2,300만원');
    expect(mixed.value).toBeNull();
    expect(mixed.status).toBe('needs_review');
    expect(mixed.raw).toBe('19억 2,300만원');
    expect(mixed.note).toBeTruthy();
  });
  it('문자열은 공백 정리, source.kind는 html', () => {
    const v = p('title', '  가   나 \n다 ');
    expect(v.value).toBe('가 나 다');
    expect(v.source?.kind).toBe('html');
  });
  it('jointVentureAllowed', () => {
    expect(p('jointVentureAllowed', '공동수급불허').value).toBe(false);
    expect(p('jointVentureAllowed', '기타').status).toBe('needs_review');
  });
});

describe('jointVentureAllowed 규칙', () => {
  it('4케이스', () => {
    expect(parseJointVenture('(전자)공동이행')).toBe(true);
    expect(parseJointVenture('공동수급불허')).toBe(false);
    expect(parseJointVenture('단독')).toBe(false);
    expect(parseJointVenture('기타')).toBeNull();
  });
  it('API 매핑에도 동일 적용', () => {
    const f = mapApiItem({ cmmnSpldmdMethdNm: '기타' }, 't');
    expect(f.jointVentureAllowed?.value).toBeNull();
    expect(f.jointVentureAllowed?.status).toBe('needs_review');
    expect(f.jointVentureAllowed?.raw).toBe('기타');
    expect(mapApiItem({ cmmnSpldmdMethdNm: '단독' }, 't').jointVentureAllowed?.value).toBe(false);
  });
});
