import { describe, expect, it } from 'vitest';
import { checkRootPath, joinRootPath } from '../../src/core/model/root-path';

describe('checkRootPath', () => {
  it('맥 경로를 받고 끝 구분자를 지운다', () => {
    expect(checkRootPath(' /Users/me/Documents/bidmate/ ', 'bidmate')).toEqual({ ok: true, path: '/Users/me/Documents/bidmate' });
  });
  it('윈도우 "경로로 복사"의 따옴표를 벗긴다', () => {
    expect(checkRootPath('"C:\\Users\\me\\Documents\\bidmate"', 'bidmate')).toEqual({ ok: true, path: 'C:\\Users\\me\\Documents\\bidmate' });
  });
  it('file:// 주소를 경로로 바꾼다', () => {
    expect(checkRootPath('file:///Users/me/%EC%9E%85%EC%B0%B0', '입찰')).toEqual({ ok: true, path: '/Users/me/입찰' });
  });
  it('맥 파일 이름의 한글 자모 분리(NFD)도 같은 폴더로 본다', () => {
    expect(checkRootPath('/Users/me/입찰'.normalize('NFD'), '입찰').ok).toBe(true);
  });
  it('마지막 폴더가 저장 폴더 이름과 다르면 거절한다', () => {
    expect(checkRootPath('/Users/me/Documents', 'bidmate').ok).toBe(false);
  });
  it('상대 경로와 빈 값은 거절한다', () => {
    expect(checkRootPath('Documents/bidmate', 'bidmate').ok).toBe(false);
    expect(checkRootPath('  ', 'bidmate').ok).toBe(false);
  });
});

describe('joinRootPath', () => {
  it('맥은 /로 잇는다', () => {
    expect(joinRootPath('/Users/me/bidmate', 'notices/2026/R26_사업')).toBe('/Users/me/bidmate/notices/2026/R26_사업');
  });
  it('윈도우는 \\로 잇는다', () => {
    expect(joinRootPath('C:\\Users\\me\\bidmate', 'notices/2026/R26')).toBe('C:\\Users\\me\\bidmate\\notices\\2026\\R26');
  });
});
