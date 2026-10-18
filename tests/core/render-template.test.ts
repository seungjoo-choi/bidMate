import { describe, expect, it } from 'vitest';
import { builtinDefaultTemplate } from '../../src/core/templates/default-template';
import { renderMail } from '../../src/core/templates/render';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { Notice } from '../../src/core/types/notice';
import type { Template } from '../../src/core/types/template';

const NOW = new Date(2026, 9, 18, 9, 0);
const tpl = (over: Partial<Template> = {}): Template => ({
  id: 't', name: 't', isDefault: false, subject: '', greeting: '', closing: '', sections: [], updatedAt: 'x', ...over,
});
const sec = (id: string, title: string, items: Template['sections'][number]['items']) => ({ id, title, items });
const item = (fieldKey: Template['sections'][number]['items'][number]['fieldKey'], label = '라벨', visible = true) => ({ fieldKey, label, visible });

describe('renderMail', () => {
  it('제목 변수를 치환한다', () => {
    const r = renderMail(tpl({ subject: '[공유] {공고명}' }), sampleNotice());
    expect(r.subject).toBe('[공유] 2026년 정보시스템 고도화 사업');
  });

  it('제목과 인사말의 {custom.키}는 사용자 정의 필드로 치환한다(리뷰 지적)', () => {
    const n = sampleNotice();
    n.customFields = { foo: { value: 'X', status: 'verified' } };
    const r = renderMail(tpl({ subject: '{custom.foo} {custom.bar}', greeting: '{custom.constructor}' }), n);
    expect(r.subject).toBe('X 확인 필요');
    expect(r.unknownVars).toEqual([]);
    expect(r.unresolved.map((u) => u.name)).toEqual(['custom.bar', 'custom.constructor']);
  });

  it('알 수 없는 변수는 원문 유지하고 unknownVars에 기록', () => {
    const r = renderMail(tpl({ subject: '{없는변수} {공고명}' }), sampleNotice());
    expect(r.subject).toContain('{없는변수}');
    expect(r.unknownVars).toEqual(['없는변수']);
  });

  it('missing와 needs_review를 표기하고 unresolved에 기록', () => {
    const n = sampleNotice();
    n.basic.title = { value: null, status: 'missing' };
    n.evaluation.performanceScore = { value: 10, status: 'needs_review' };
    const r = renderMail(tpl({
      subject: '{공고명}',
      sections: [sec('s1', '평가', [item('performanceScore', '실적'), item('title', '사업명')])],
    }), n);
    expect(r.subject).toBe('확인 필요');
    expect(r.text).toContain('- 실적: 10점 (확인 필요)');
    expect(r.unresolved).toEqual(expect.arrayContaining([
      { name: '공고명', label: '공고명', status: 'missing', where: 'subject' },
      { name: '실적평가', label: '실적', status: 'needs_review', where: 's1' },
      { name: '공고명', label: '사업명', status: 'missing', where: 's1' },
    ]));
  });

  it('HTML 이스케이프', () => {
    const n = sampleNotice();
    n.basic.title = { value: `<b>&"'`, status: 'verified' };
    const r = renderMail(tpl({
      greeting: '<i>안녕</i>',
      sections: [sec('s1', '<s>제목</s>', [item('title', '<라벨>')])],
    }), n);
    expect(r.html).toContain('&lt;b&gt;&amp;&quot;&#39;');
    expect(r.html).toContain('&lt;i&gt;안녕&lt;/i&gt;');
    expect(r.html).toContain('&lt;s&gt;제목&lt;/s&gt;');
    expect(r.html).toContain('&lt;라벨&gt;');
    expect(r.html).not.toContain('<b>');
  });

  it('javascript: URL은 평문, https는 링크', () => {
    const n = sampleNotice();
    n.sourceUrl = { value: 'javascript:alert(1)', status: 'verified' };
    const t = tpl({ sections: [sec('s1', '자료', [item('sourceUrl', 'URL')])] });
    expect(renderMail(t, n).html).not.toContain('<a ');
    n.sourceUrl = { value: 'https://example.com/a?b=1&c=2', status: 'verified' };
    expect(renderMail(t, n).html).toContain('<a href="https://example.com/a?b=1&amp;c=2">');
  });

  it('첨부 표기와 첨부 없음', () => {
    const n = sampleNotice();
    n.attachments[1]!.status = 'failed';
    n.attachments.push({ ...n.attachments[0]!, id: 'a3', index: 2, originalName: '표.xlsx', status: 'pending' });
    const t = tpl({ sections: [sec('s1', '자료', [item('attachmentList', '첨부')])] });
    const r = renderMail(t, n);
    expect(r.html).toContain('<ul');
    expect(r.html).toContain('<li>제안요청서.pdf (다운로드 실패)</li>');
    expect(r.html).toContain('<li>표.xlsx (미확보)</li>');
    expect(r.text).toContain('- 첨부:\n  - 공고문.hwp\n  - 제안요청서.pdf (다운로드 실패)');
    n.attachments = [];
    const e = renderMail(t, n);
    expect(e.text).toContain('- 첨부: 첨부 없음');
    expect(e.html).toContain('첨부 없음');
    expect(e.unresolved).toEqual([]);
  });

  it('숨김 항목과 섹션 생략, 번호 재부여', () => {
    const r = renderMail(tpl({
      sections: [
        sec('a', '첫째', [item('title', '사업명', false)]),
        sec('b', '둘째', [item('title', '사업명'), item('noticeNo', '번호', false)]),
        sec('c', '셋째', [item('noticeNo', '번호')]),
      ],
    }), sampleNotice());
    expect(r.text).not.toContain('첫째');
    expect(r.text).not.toContain('- 번호: R26BK00000000\n\n3.');
    expect(r.html).toContain('<h3>1. 둘째</h3>');
    expect(r.html).toContain('<h3>2. 셋째</h3>');
    expect(r.text).toContain('1. 둘째\n- 사업명:');
    expect(r.text).toContain('2. 셋째');
  });

  it('인사말 줄바꿈은 br, 빈 인사말/맺음말은 블록 생략', () => {
    const r = renderMail(tpl({ greeting: '가\n나' }), sampleNotice());
    expect(r.html).toContain('가<br>나');
    expect(r.html).not.toContain('<p></p>');
    expect(r.text).toBe('가\n나');
  });

  it('기본 템플릿과 표본 공고에서 unknownVars 없음', () => {
    const r = renderMail(builtinDefaultTemplate(NOW), sampleNotice());
    expect(r.unknownVars).toEqual([]);
    expect(r.subject).toBe('[입찰공고 공유] 2026년 정보시스템 고도화 사업');
    expect(r.unresolved.length).toBeGreaterThan(0);
    expect(r.unresolved.every((u) => u.status === 'needs_review')).toBe(true);
  });

  it('결정론', () => {
    const t = builtinDefaultTemplate(NOW);
    const n: Notice = sampleNotice();
    expect(renderMail(t, n)).toEqual(renderMail(t, n));
  });

  it('값 포맷', () => {
    const r = renderMail(tpl({
      sections: [sec('s', '값', [item('budgetAmount', '금액'), item('bidCloseAt', '마감'), item('jointVentureAllowed', '공동'), item('differentialScoring', '차등')])],
    }), sampleNotice());
    expect(r.text).toContain('- 금액: 5억 원 (500,000,000원)');
    expect(r.text).toContain('- 마감: 2026-10-22 14:00');
    expect(r.text).toContain('- 공동: 허용');
    expect(r.text).toContain('- 차등: 적용');
  });

  it('제목의 줄바꿈은 공백으로 치환', () => {
    const r = renderMail(tpl({ subject: '가\n나\r\n다 {공고번호}\t' }), sampleNotice());
    expect(r.subject).toBe('가 나 다 R26BK00000000');
  });
});
