import { describe, expect, it } from 'vitest';
import { builtinDefaultTemplate, builtinPrespecTemplate } from '../../src/core/templates/default-template';
import { renderMail } from '../../src/core/templates/render';
import { resolveValue } from '../../src/core/templates/values';
import type { FieldValue } from '../../src/core/types/common';
import { sampleNotice, samplePrespecNotice } from '../../src/core/templates/sample-notice';
import { variablesFor } from '../../src/core/templates/variables';
import type { Notice } from '../../src/core/types/notice';
import type { Template, TemplateFieldKey, TemplateItem, TemplateSection, TemplateStyle } from '../../src/core/types/template';

const NOW = new Date(2026, 9, 18, 9, 0);
const tpl = (over: Partial<Template> = {}): Template => ({
  id: 't', name: 't', isDefault: false, subject: '', greeting: '', closing: '', layout: 'table', sections: [], updatedAt: 'x', ...over,
});
const sec = (id: string, title: string, items: TemplateItem[], inlineValue?: string): TemplateSection => ({ id, title, ...(inlineValue ? { inlineValue } : {}), items });
const item = (fieldKey: TemplateFieldKey, label = '라벨', visible = true, style?: TemplateStyle): TemplateItem => ({ fieldKey, label, visible, ...(style ? { style } : {}) });
const txt = (text: string, label = '라벨', visible = true, style?: TemplateStyle): TemplateItem => ({ kind: 'text', id: 'x', label, text, visible, ...(style ? { style } : {}) });
const lst = (sections: TemplateSection[], over: Partial<Template> = {}) => tpl({ layout: 'list', sections, ...over });

describe('renderMail', () => {
  it('{오늘}은 한국 시간 기준 YYYYMMDD로 치환한다', () => {
    const r = renderMail(tpl({ subject: '[{오늘}] {공고명}' }), sampleNotice(), { now: new Date('2026-10-18T15:30:00Z') });
    expect(r.subject).toBe('[20261019] 2026년 정보시스템 고도화 사업');
    expect(r.unresolved).toEqual([]);
  });

  it('항목으로 넣은 오늘도 같은 값이다', () => {
    const r = renderMail(tpl({ sections: [sec('s', '기본', [item('today', '작성일')])] }), sampleNotice(), { now: new Date('2026-01-05T00:00:00Z') });
    expect(r.text).toContain('20260105');
  });

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
    expect(r.text).toContain('- 금액: 500,000,000 원');
    expect(r.text).toContain('- 마감: 2026/10/22 14:00');
    expect(r.text).toContain('- 공동: 허용');
    expect(r.text).toContain('- 차등: 적용');
  });

  it('제목의 줄바꿈은 공백으로 치환', () => {
    const r = renderMail(tpl({ subject: '가\n나\r\n다 {공고번호}\t' }), sampleNotice());
    expect(r.subject).toBe('가 나 다 R26BK00000000');
  });

  it('실적인정금액은 억/만 표기, 수집일시는 슬래시 표기', () => {
    const n = sampleNotice();
    n.evaluation.performanceMinAmount = { value: 250_000_000, status: 'verified' };
    n.collect.collectedAt = new Date(2026, 9, 18, 9, 5).toISOString();
    const r = renderMail(tpl({ sections: [sec('s', '값', [item('performanceMinAmount', '실적금액'), item('collectedAt', '수집')])] }), n);
    expect(r.text).toContain('- 실적금액: 2억 5,000만 원');
    expect(r.text).toContain('- 수집: 2026/10/18 09:05');
  });

  describe('list 레이아웃', () => {
    it('inlineValue 섹션은 한 줄로 찍는다', () => {
      const n = sampleNotice();
      const r = renderMail(lst([sec('o', '기관명', [], '{발주기관}')]), n);
      expect(r.text).toBe(`1. 기관명 : ${n.basic.orderingOrg.value}`);
      expect(r.html).toContain(`<strong>1. 기관명</strong> : ${n.basic.orderingOrg.value}`);
    });

    it('항목 번호, 숨김 항목 제외, 빈 라벨', () => {
      const r = renderMail(lst([sec('s', '정보', [item('title', '사업명'), item('noticeNo', '번호', false), item('noticeNo', '', true)])]), sampleNotice());
      expect(r.text).toBe('1. 정보\n  1) 사업명 : 2026년 정보시스템 고도화 사업\n  2) R26BK00000000');
      expect(r.html).toContain('<div style="padding-left:1.5em;">1) 사업명 : 2026년 정보시스템 고도화 사업</div>');
      expect(r.html).toContain('<div style="padding-left:1.5em;">2) R26BK00000000</div>');
    });

    it('text 항목은 변수를 합성하고 missing이면 확인 필요, unresolved 기록', () => {
      const t = lst([sec('s', '정보', [txt('{참가자격등록마감}까지', '등록')])]);
      expect(renderMail(t, sampleNotice()).text).toContain('  1) 등록 : 2026/10/20 17:00까지');
      const n = sampleNotice();
      n.schedule.registrationDeadline = { value: null, status: 'missing' };
      const r = renderMail(t, n);
      expect(r.text).toContain('  1) 등록 : 확인 필요까지');
      expect(r.unresolved).toEqual([{ name: '참가자격등록마감', label: '참가자격등록마감', status: 'missing', where: 's' }]);
    });

    it('고정 문구와 빈 문구', () => {
      const r = renderMail(lst([sec('s', '부서', [txt('넥스트업사업본부', '부서명'), txt('', '제안PM')])]), sampleNotice());
      expect(r.text).toContain('  1) 부서명 : 넥스트업사업본부');
      expect(r.text).toContain('  2) 제안PM : ');
      expect(r.unresolved).toEqual([]);
      expect(r.unknownVars).toEqual([]);
    });

    it('첨부 목록', () => {
      const r = renderMail(lst([sec('s', '자료', [item('attachmentList', '첨부')])]), sampleNotice());
      expect(r.text).toContain('  1) 첨부 :\n    - 공고문.hwp');
      expect(r.html).toContain('1) 첨부 :<ul');
    });

    it('섹션 사이 빈 줄 없음, 인사말과 첫 섹션 사이는 빈 줄', () => {
      const r = renderMail(lst([sec('a', 'A', [txt('x')]), sec('b', 'B', [txt('y')])], { greeting: '안녕', closing: '끝' }), sampleNotice());
      expect(r.text).toBe('안녕\n\n1. A\n  1) 라벨 : x\n2. B\n  1) 라벨 : y\n\n끝');
    });
  });

  it('스타일은 값에만 적용된다', () => {
    const bu = { bold: true, underline: true };
    const r = renderMail(lst([sec('s', '정보', [txt('값1', '가', true, bu), txt('값2', '나', true, { bold: true }), txt('값3', '다')])]), sampleNotice());
    expect(r.html).toContain('1) 가 : <strong><u>값1</u></strong>');
    expect(r.html).toContain('2) 나 : <strong>값2</strong>');
    expect(r.html).toContain('3) 다 : 값3');
    expect(r.text).not.toMatch(/<|>/);
    const t = renderMail(tpl({ sections: [sec('s', '정보', [txt('값1', '가', true, bu)])] }), sampleNotice());
    expect(t.html).toContain('<td style="padding:4px 0;vertical-align:top;"><strong><u>값1</u></strong></td>');
  });

  it('table 레이아웃에서 text 항목과 inlineValue', () => {
    const r = renderMail(tpl({ sections: [sec('s', '정보', [txt('값', '라벨')], '{공고명}')] }), sampleNotice());
    expect(r.text).toBe('1. 정보 : 2026년 정보시스템 고도화 사업\n- 라벨: 값');
    expect(r.html).toContain('<h3>1. 정보 : 2026년 정보시스템 고도화 사업</h3>');
  });

  it('섹션 생략 조건', () => {
    const r = renderMail(lst([
      sec('a', '없음', []),
      sec('b', '있음', [], '값'),
      sec('c', '숨김', [txt('x', 'l', false)]),
    ]), sampleNotice());
    expect(r.text).toBe('1. 있음 : 값');
  });

  it('title/label/inlineValue/text 이스케이프', () => {
    const r = renderMail(lst([sec('s', '<b>제목</b>', [txt('<b>문구</b>', '<b>라벨</b>')], '<b>값</b>')]), sampleNotice());
    expect(r.html).toContain('&lt;b&gt;제목&lt;/b&gt;');
    expect(r.html).toContain('&lt;b&gt;라벨&lt;/b&gt;');
    expect(r.html).toContain('&lt;b&gt;값&lt;/b&gt;');
    expect(r.html).toContain('&lt;b&gt;문구&lt;/b&gt;');
    expect(r.html).not.toContain('<b>');
  });

  it('기본 템플릿과 표본 공고의 목록형 본문', () => {
    const r = renderMail(builtinDefaultTemplate(NOW), sampleNotice());
    const lines = r.text.split('\n');
    expect(r.unknownVars).toEqual([]);
    expect(lines).toContain('1. 기관명 : 한국정보기관');
    expect(lines).toContain('  5) 사업금액 : 500,000,000 원(VAT 포함)');
    expect(lines).toContain('  10) 실적점수 평가 : 3년 이내 국내외 유사사업 수행실적(10점 (확인 필요)) - 2억 5,000만 원 이상인 사업에 한함');
    const i = lines.indexOf('4. 제안부서');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe('  1) 부서명 : 넥스트업사업본부');
    expect(lines[i + 2]).toBe('  2) 제안PM : ');
  });
});

describe('renderMail 사전규격', () => {
  it('사전규격 변수를 치환한다', () => {
    const r = renderMail(builtinPrespecTemplate(NOW), samplePrespecNotice(), { now: NOW });
    expect(r.subject).toBe('[사전규격 공유] 2027년 정보시스템 고도화 사업');
    expect(r.text).toContain('R26BD00000000');
    expect(r.text).toContain('홍길동 (044-000-0000)');
    expect(r.text).toContain('규격서.hwp');
    expect(r.unresolved).toEqual([]);
    expect(r.unknownVars).toEqual([]);
  });
  it('bid 공고에서 사전규격 변수는 기존 미확인 표시', () => {
    const r = renderMail(tpl({ subject: '{사전규격명}' }), sampleNotice());
    expect(r.subject).toBe('확인 필요');
    expect(r.unresolved.map((u) => u.name)).toEqual(['사전규격명']);
  });
  it('variablesFor는 종류별 변수만 돌려준다', () => {
    expect(variablesFor('prespec').map((d) => d.name)).toContain('사전규격명');
    expect(variablesFor('prespec').map((d) => d.name)).not.toContain('공고명');
    expect(variablesFor('bid').map((d) => d.name)).not.toContain('사전규격명');
    expect(variablesFor('bid').map((d) => d.name)).toContain('발주기관');
  });
});

describe('합성 항목과 공동수급 표기', () => {
  const fv = <T,>(value: T | null, status: 'verified' | 'needs_review' | 'missing' = 'verified', raw?: string): FieldValue<T> => ({ value, status, ...(raw !== undefined ? { raw } : {}) });
  const withEval = (over: Partial<Notice['evaluation']>): Notice => {
    const n = sampleNotice();
    n.evaluation = { ...n.evaluation, credibilityScore: fv<number>(null, 'missing'), managementScore: fv<number>(null, 'missing'), ...over };
    return n;
  };

  it('단독 대외신인도 변수: 경영상태로 충족이면 확인 필요 대신 사유', () => {
    const note = { ...fv<number>(null, 'needs_review', '가점 6항목, 감점 2항목'), note: '가감점 표만 있음, 합계 배점 없음' };
    expect(resolveValue(withEval({ managementScore: fv(4), credibilityScore: note }), 'credibilityScore')).toMatchObject({ text: '가감점 표만 있음, 합계 배점 없음', status: 'ok' });
    expect(resolveValue(withEval({ managementScore: fv(4) }), 'credibilityScore')).toMatchObject({ text: '별도 배점 없음', status: 'ok' });
    expect(resolveValue(withEval({ credibilityScore: note }), 'credibilityScore').status).toBe('missing');
    expect(resolveValue(withEval({ managementScore: fv(4, 'needs_review') }), 'credibilityScore').status).toBe('missing');
  });
  it('경영상태만 있으면 경영상태 조각만', () => {
    expect(resolveValue(withEval({ managementScore: fv(4) }), 'credibilityEval')).toMatchObject({ text: '경영상태(신용평가등급) 평가(4점)', status: 'ok' });
  });
  it('대외신인도만 있으면 대외신인도 조각만', () => {
    expect(resolveValue(withEval({ credibilityScore: fv(5) }), 'credibilityEval').text).toBe('대외신인도(5점)');
  });
  it('둘 다 있으면 경영상태 먼저 연결', () => {
    expect(resolveValue(withEval({ managementScore: fv(4), credibilityScore: fv(5) }), 'credibilityEval').text).toBe('경영상태(신용평가등급) 평가(4점), 대외신인도(5점)');
  });
  it('조각이 needs_review면 확인 필요를 붙이고 전체도 needs_review', () => {
    expect(resolveValue(withEval({ managementScore: fv(4, 'needs_review') }), 'credibilityEval')).toMatchObject({ text: '경영상태(신용평가등급) 평가(4점) (확인 필요)', status: 'needs_review' });
  });
  it('둘 다 없으면 확인 필요 missing', () => {
    expect(resolveValue(withEval({}), 'credibilityEval')).toEqual({ text: '확인 필요', status: 'missing', raw: null });
  });

  it('credibilityEval: 점수가 없고 정량평가 문서 문장이 있으면 그 문장(ok)', () => {
    const n = withEval({ quantEvalDoc: fv('정량평가 : 조달청(경영상태), 수요기관(수행실적)') });
    expect(resolveValue(n, 'credibilityEval')).toMatchObject({ text: '정량평가 : 조달청(경영상태), 수요기관(수행실적)', status: 'ok' });
  });
  it('credibilityEval: 점수가 있으면 문서 문장보다 점수 우선', () => {
    const n = withEval({ managementScore: fv(4), quantEvalDoc: fv('정량평가 : 조달청(경영상태)') });
    expect(resolveValue(n, 'credibilityEval').text).toBe('경영상태(신용평가등급) 평가(4점)');
  });
  it('credibilityEval: 점수도 문장도 없으면 확인 필요', () => {
    expect(resolveValue(withEval({ quantEvalDoc: fv<string>(null, 'missing') }), 'credibilityEval')).toEqual({ text: '확인 필요', status: 'missing', raw: null });
  });

  it('user_edited 문장은 키워드가 없어도 그대로 쓴다', () => {
    const n = withEval({ quantEvalDoc: { value: '직접 입력한 평가 설명', status: 'user_edited' } as FieldValue<string> });
    expect(resolveValue(n, 'credibilityEval')).toMatchObject({ text: '직접 입력한 평가 설명', status: 'ok' });
  });
  it('quantEvalDoc 항목 필터: measure3에서 틀린 6건 원문', () => {
    const cred = (t: string) => resolveValue(withEval({ quantEvalDoc: fv(t) }), 'credibilityEval');
    const perf = (t: string) => {
      const n = sampleNotice();
      n.evaluation = { ...n.evaluation, performanceScore: fv<number>(null, 'missing'), performancePeriod: fv<string>(null, 'missing'), performanceMinAmount: fv<number>(null, 'missing'), quantEvalDoc: fv(t) };
      return resolveValue(n, 'performanceEval');
    };
    const MISS = { text: '확인 필요', status: 'missing', raw: null };
    // R26BK01501286: 실적만 언급 -> 신인도 칸에는 쓰지 않고 실적 칸에는 쓴다
    expect(cred('정량평가(사업수행실적) : 축산물품질관리원')).toEqual(MISS);
    expect(perf('정량평가(사업수행실적) : 축산물품질관리원').text).toBe('정량평가(사업수행실적) : 축산물품질관리원');
    // R26BK01396439, R26BK01587853, R25BK00876294, 20240603548: 경영상태만 언급 -> 실적 칸 불가, 신인도 칸 가능
    for (const t of ['정량평가 : 조달청(경영상태)', '정량평가(경영상태) 기관 : 발주기관', '조달청 : 정성평가, 정량평가(경영상태)']) {
      expect(perf(t)).toEqual(MISS);
      expect(cred(t).text).toBe(t);
    }
    // 20231127127: 신인도만 언급
    expect(perf('신인도 평가관련 : [별표 11] 적용')).toEqual(MISS);
    expect(cred('신인도 평가관련 : [별표 11] 적용').text).toBe('신인도 평가관련 : [별표 11] 적용');
  });
  it('performanceEval: 점수가 있으면 기본 템플릿 10번(옛 문구)과 같은 결과', () => {
    const n = sampleNotice();
    expect(resolveValue(n, 'performanceEval')).toMatchObject({ text: '3년 이내 국내외 유사사업 수행실적(10점 (확인 필요)) - 2억 5,000만 원 이상인 사업에 한함', status: 'needs_review' });
    const old = '{실적인정기간} 이내 국내외 유사사업 수행실적({실적평가}) - {실적인정금액} 이상인 사업에 한함';
    expect(renderMail(tpl({ subject: old }), n).subject).toBe(resolveValue(n, 'performanceEval').text);
  });
  it('performanceEval: 점수·기간·금액이 모두 없고 문장만 있으면 그 문장', () => {
    const n = sampleNotice();
    n.evaluation = { ...n.evaluation, performanceScore: fv<number>(null, 'missing'), performancePeriod: fv<string>(null, 'missing'), performanceMinAmount: fv<number>(null, 'missing'), quantEvalDoc: fv('정량평가 : 조달청(경영상태), 수요기관(수행실적)') };
    expect(resolveValue(n, 'performanceEval')).toMatchObject({ text: '정량평가 : 조달청(경영상태), 수요기관(수행실적)', status: 'ok' });
  });
  it('performanceEval: 모두 없으면 확인 필요, 일부만 없으면 기존 문구에 확인 필요', () => {
    const n = sampleNotice();
    n.evaluation = { ...n.evaluation, performanceScore: fv<number>(null, 'missing'), performancePeriod: fv<string>(null, 'missing'), performanceMinAmount: fv<number>(null, 'missing'), quantEvalDoc: fv<string>(null, 'missing') };
    expect(resolveValue(n, 'performanceEval')).toEqual({ text: '확인 필요', status: 'missing', raw: null });
    n.evaluation.performanceScore = fv(10);
    expect(resolveValue(n, 'performanceEval')).toMatchObject({ text: '확인 필요 이내 국내외 유사사업 수행실적(10점) - 확인 필요 이상인 사업에 한함', status: 'needs_review' });
  });

  it('공동수급 방식 표기', () => {
    const jv = (f: FieldValue<boolean>) => { const n = sampleNotice(); n.basic.jointVentureAllowed = f; return resolveValue(n, 'jointVentureAllowed').text; };
    expect(jv(fv(true, 'verified', '(전자)공동이행'))).toBe('허용(공동이행방식)');
    expect(jv(fv(true, 'verified', '(전자)주계약자관리'))).toBe('허용(주계약자관리방식)');
    expect(jv(fv(false))).toBe('불허');
    expect(jv(fv<boolean>(null, 'needs_review', '기타'))).toBe('기타 (확인 필요)');
  });

  it('평가방법은 문서 원문 우선, 없으면 API 값', () => {
    const n = sampleNotice();
    n.evaluation.evalMethodDoc = fv('기술평가위원회 온라인 소집평가');
    expect(resolveValue(n, 'evalMethodText').text).toBe('기술평가위원회 온라인 소집평가');
    n.evaluation.evalMethodDoc = fv<string>(null, 'missing');
    expect(resolveValue(n, 'evalMethodText').text).toBe('기술 90 : 가격 10');
  });

  it('{공고정보평가방법}은 API 값', () => {
    const n = sampleNotice();
    n.evaluation.evalMethodDoc = fv('문서 원문 평가');
    const r = renderMail(tpl({ subject: '{공고정보평가방법} / {평가방법}' }), n);
    expect(r.subject).toBe('기술 90 : 가격 10 / 문서 원문 평가');
  });
});
