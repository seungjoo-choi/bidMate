import { describe, expect, it } from 'vitest';
import { locateCitations, locateConflicts, type AskVerifyDoc } from '../../src/core/search/ask-verify';

const docs: AskVerifyDoc[] = [
  {
    id: 'a', name: '[01] 제안요청서.txt', textPath: 'source/text/a.txt',
    text: ['[p 2]', '사업기간은 계약일로부터 12개월이다.', '[표 1]', '[셀 0 0] 구분', '[셀 0 1] 기간', '[셀 1 0] 착수', '[셀 1 1] 계약 후 7일'].join('\n'),
  },
  { id: 'b', name: '공고문.txt', textPath: 'source/text/b.txt', text: '입찰보증금은 면제한다.' },
];
const cite = (o: Partial<{ file: string | null; quote: string }>) => ({ file: '[01] 제안요청서.txt' as string | null, page: null, quote: '', note: '', ...o });

describe('locateCitations', () => {
  it('정확 일치는 줄·쪽을 돌려준다', () => {
    const [c] = locateCitations([cite({ quote: '사업기간은 계약일로부터 12개월이다.' })], docs);
    expect(c!.located).toMatchObject({ docId: 'a', textPath: 'source/text/a.txt', line: 2, endLine: 2, page: 2 });
  });
  it('표 행 조각(a | b)도 찾는다', () => {
    const [c] = locateCitations([cite({ quote: '착수 | 계약 후 7일' })], docs);
    expect(c!.located).toMatchObject({ docId: 'a', line: 6 });
  });
  it('못 찾으면 located null(답은 유지)', () => {
    const [c] = locateCitations([cite({ quote: '문서에 없는 문장입니다 절대로' })], docs);
    expect(c!.located).toBeNull();
    expect(c!.quote).toBe('문서에 없는 문장입니다 절대로');
  });
  it('파일명 endsWith 매칭', () => {
    const [c] = locateCitations([cite({ file: '제안요청서.txt', quote: '사업기간은 계약일로부터 12개월이다.' })], docs);
    expect(c!.located!.docId).toBe('a');
  });
  it('경로 경계 일치는 경고 없음, 경계 없는 endsWith는 찾되 경고', () => {
    const pathDocs: AskVerifyDoc[] = [{ id: 'p', name: 'source/text/공고문.txt', textPath: 't', text: '입찰보증금은 면제한다.' }];
    const w1: string[] = [];
    expect(locateCitations([cite({ file: '공고문.txt', quote: '입찰보증금은 면제한다.' })], pathDocs, w1)[0]!.located!.docId).toBe('p');
    expect(w1).toEqual([]);
    const w2: string[] = [];
    expect(locateCitations([cite({ file: '문.txt', quote: '입찰보증금은 면제한다.' })], pathDocs, w2)[0]!.located!.docId).toBe('p');
    expect(w2).toHaveLength(1);
  });
  it('다른 파일에서 찾으면 warning', () => {
    const warnings: string[] = [];
    const [c] = locateCitations([cite({ file: '[01] 제안요청서.txt', quote: '입찰보증금은 면제한다.' })], docs, warnings);
    expect(c!.located!.docId).toBe('b');
    expect(warnings).toHaveLength(1);
  });
});

describe('locateConflicts', () => {
  it('values도 같은 방식으로 위치를 찾는다', () => {
    const [c] = locateConflicts([{ topic: '기간', values: [
      { file: '공고문.txt', quote: '입찰보증금은 면제한다.', value: '면제' },
      { file: '공고문.txt', quote: '없는 문장입니다 정말로', value: 'x' },
    ] }], docs);
    expect(c!.values[0]!.located!.docId).toBe('b');
    expect(c!.values[1]!.located).toBeNull();
  });
});
