import { describe, expect, it } from 'vitest';
import { buildExcerpt, buildFullText, type ExcerptFileInput } from '../../src/core/ai/excerpt';
import { API_FULLTEXT_MAX_CHARS, EXCERPT_FILE_MAX_CHARS } from '../../src/core/ai/constants';

const syn = { credibility: ['신용평가'], management: ['경영상태'], mgmtExclude: ['제재키워드'], performance: ['수행실적'], bonusLabel: [], scoreHeader: ['배점한도'], perfAnchor: ['인정범위'] };
const filler = (n: number, tag = '무관') => Array.from({ length: n }, (_, i) => `${tag}${i}`);
const file = (text: string, over: Partial<ExcerptFileInput> = {}): ExcerptFileInput => ({
  attachmentId: 'a1', sourceFile: 'a1.hwp', name: '제안요청서.hwp', kindLabel: '제안요청서', priority: 1, text, ...over,
});

describe('buildExcerpt', () => {
  it('가까운 키워드 창을 하나로 병합한다', () => {
    const lines = [...filler(20), '신용평가 10점', ...filler(5, '중간'), '경영상태 5점', ...filler(40, '뒤')];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: syn });
    expect(r.text.match(/^--- /gm)).toHaveLength(1);
    expect(r.text).toContain('신용평가 10점');
    expect(r.text).toContain('경영상태 5점');
    expect(r.text).not.toContain('무관0\n');
  });

  it('표 안 키워드는 창(30줄)을 넘어도 표 끝까지 포함한다', () => {
    const cells = Array.from({ length: 60 }, (_, i) => `[셀 ${i + 1} 0] 항목${i}`);
    const lines = [...filler(10), '[표 1]', '[셀 0 0] 수행실적', ...cells, ...filler(5, '꼬리')];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: syn });
    expect(r.text).toContain('항목59');
    expect(r.text).not.toContain('꼬리0');
  });

  it('같은 r의 셀을 한 줄로 이어 붙이고 [표 k]를 유지한다', () => {
    const lines = ['[표 3]', '[셀 0 0] 신용평가', '[셀 0 1] 10점', '[셀 1 0] 경영상태', '[셀 1 1 rs2] 5점'];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: syn });
    expect(r.text).toContain('[표 3]');
    expect(r.text).toContain('신용평가 | 10점');
    expect(r.text).toContain('경영상태 | 5점');
    expect(r.text).not.toContain('[셀');
  });

  it('머리글에 파일명·종류, 구간 머리글에 쪽과 줄 범위를 쓴다', () => {
    const lines = ['[p 1]', '서문', '[p 2]', ...filler(10), '신용평가 10점'];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: syn });
    expect(r.text).toContain('=== 파일: 제안요청서.hwp (제안요청서) ===');
    expect(r.text).toContain('--- [p 2] 부근, 줄 8~14 ---');
    const noPage = buildExcerpt({ files: [file('신용평가 10점')], synonyms: syn });
    expect(noPage.text).toContain('--- 쪽 미상, 줄 1~1 ---');
  });

  it('mgmtExclude 키워드는 발췌 키워드가 아니다', () => {
    const r = buildExcerpt({ files: [file([...filler(80), '제재키워드', ...filler(5)].join('\n'))], synonyms: syn });
    expect(r.text).not.toContain('제재키워드'); // 키워드 없는 파일 = 앞 60줄만
  });

  it('키워드 없는 파일은 앞 60줄만', () => {
    const r = buildExcerpt({ files: [file(filler(100).join('\n'))], synonyms: syn });
    expect(r.text).toContain('무관59');
    expect(r.text).not.toContain('무관60');
  });

  it('파일 상한을 넘으면 뒤쪽 구간을 빼고 truncated', () => {
    const block = (k: number) => [`신용평가 구간${k}`, ...Array.from({ length: 40 }, () => '가'.repeat(200))];
    const text = [0, 1, 2, 3].flatMap((k) => [...block(k), ...filler(40)]).join('\n');
    const r = buildExcerpt({ files: [file(text)], synonyms: syn });
    expect(r.truncated).toBe(true);
    expect(r.files[0]!.truncated).toBe(true);
    expect(r.files[0]!.chars).toBeLessThanOrEqual(EXCERPT_FILE_MAX_CHARS);
    expect(r.text).toContain('구간0');
    expect(r.text).not.toContain('구간3');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('총 상한을 넘으면 priority 낮은 파일(뒤쪽)부터 뺀다', () => {
    const big = (tag: string) => [`신용평가 ${tag}`, ...Array.from({ length: 70 }, () => '나'.repeat(500))].join('\n');
    const files = [1, 2, 3, 4].map((p) => file(big(`P${p}`), { attachmentId: `a${p}`, name: `f${p}.hwp`, priority: p }));
    const r = buildExcerpt({ files: files.slice().reverse(), synonyms: syn, maxChars: 40_000 });
    expect(r.chars).toBeLessThanOrEqual(40_000);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('P1');
    expect(r.text).not.toContain('P4');
    const small = buildExcerpt({ files, synonyms: syn, maxChars: 20_000 });
    expect(small.chars).toBeLessThanOrEqual(20_000);
  });

  it('총 상한 축소 순서: 가장 뒤 파일부터 통째로 빼고 P1은 온전하다', () => {
    const seg = (tag: string) => [`신용평가 ${tag}`, ...Array.from({ length: 30 }, () => '가'.repeat(150)), ...filler(40, `채움${tag}`)];
    const p1 = [0, 1, 2].flatMap((k) => seg(`P1구간${k}`)).join('\n');
    const one = (tag: string) => [`신용평가 ${tag}`, ...Array.from({ length: 30 }, () => '나'.repeat(500))].join('\n');
    const files = [
      file(p1, { attachmentId: 'a1', name: 'f1.hwp', priority: 1 }),
      file(one('P2'), { attachmentId: 'a2', name: 'f2.hwp', priority: 2 }),
      file(one('P3'), { attachmentId: 'a3', name: 'f3.hwp', priority: 3 }),
      file(one('P4'), { attachmentId: 'a4', name: 'f4.hwp', priority: 4 }),
    ];
    const r = buildExcerpt({ files, synonyms: syn, maxChars: 50_000 });
    expect(r.chars).toBeLessThanOrEqual(50_000);
    expect(r.files.map((f) => f.name)).toEqual(['f1.hwp', 'f2.hwp', 'f3.hwp']);
    expect(r.files[0]!.truncated).toBe(false);
    ['P1구간0', 'P1구간1', 'P1구간2'].forEach((t) => expect(r.text).toContain(t));
    expect(r.text).not.toContain('P4');
    expect(r.warnings.some((w) => w.includes('f4.hwp'))).toBe(true);
  });

  it('파일 상한 warning과 총 상한 warning을 각각 기록한다', () => {
    const big = (tag: string) => [`신용평가 ${tag}`, ...Array.from({ length: 70 }, () => '다'.repeat(1000))].join('\n');
    const files = [1, 2, 3, 4].map((p) => file(big(`Q${p}`), { attachmentId: `a${p}`, name: `g${p}.hwp`, priority: p }));
    const r = buildExcerpt({ files, synonyms: syn, maxChars: 60_000 });
    expect(r.warnings.some((w) => w.includes('파일 발췌 상한'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('총 발췌 상한'))).toBe(true);
  });

  it('keys를 주면 파일 상한 초과 시 대상 항목 키워드가 적은 구간부터 뺀다', () => {
    const block = (head: string) => [head, ...Array.from({ length: 40 }, () => '가'.repeat(200))];
    const text = [...block('신용평가 앞구간0'), ...filler(40), ...block('신용평가 앞구간1'), ...filler(40),
      ...block('신용평가 앞구간2'), ...filler(40), ...block('수행실적 10억원 이상의 실적'), ...filler(40)].join('\n');
    const plain = buildExcerpt({ files: [file(text)], synonyms: syn });
    expect(plain.text).not.toContain('10억원');
    const r = buildExcerpt({ files: [file(text)], synonyms: syn, keys: ['performanceMinAmount'] });
    expect(r.text).toContain('수행실적 10억원 이상의 실적');
    expect(r.files[0]!.chars).toBeLessThanOrEqual(EXCERPT_FILE_MAX_CHARS);
    expect(r.warnings.some((w) => w.includes('관련도 낮은'))).toBe(true);
  });

  it('keys를 주면 총 상한 초과 시 priority와 무관하게 관련 없는 파일을 먼저 뺀다', () => {
    const one = (head: string) => [head, ...Array.from({ length: 30 }, () => '나'.repeat(500))].join('\n');
    const files = [
      file(one('신용평가 P1'), { attachmentId: 'a1', name: 'f1.hwp', priority: 1 }),
      file(one('신용평가 P2'), { attachmentId: 'a2', name: 'f2.hwp', priority: 2 }),
      file(one('수행실적 5억원 P3'), { attachmentId: 'a3', name: 'f3.hwp', priority: 3 }),
    ];
    const r = buildExcerpt({ files, synonyms: syn, maxChars: 32_000, keys: ['performanceMinAmount'] });
    expect(r.chars).toBeLessThanOrEqual(32_000);
    expect(r.text).toContain('P3');
    expect(r.text).toContain('P1');
    expect(r.text).not.toContain('P2');
  });

  it('입력에 없는 추출값은 출력에 나타나지 않는다(텍스트·파일 정보만 사용)', () => {
    const r = buildExcerpt({ files: [file('신용평가 10점')], synonyms: syn });
    expect(Object.keys(r).sort()).toEqual(['chars', 'files', 'text', 'truncated', 'warnings']);
    expect(r.files[0]).toEqual({ attachmentId: 'a1', sourceFile: 'a1.hwp', name: '제안요청서.hwp', chars: r.files[0]!.chars, truncated: false });
  });
});

describe('buildFullText', () => {
  it('priority순 전문을 머리글과 함께 잇고 셀 줄은 한 줄로 렌더링한다', () => {
    const a = file('[표 1]\n[셀 0 0] 신용평가\n[셀 0 1] 10점\n본문', { attachmentId: 'a', name: '뒤.hwp', priority: 2 });
    const b = file('앞 문서 내용', { attachmentId: 'b', name: '앞.hwp', priority: 1 });
    const r = buildFullText({ files: [a, b], synonyms: syn })!;
    expect(r.text.indexOf('=== 파일: 앞.hwp (제안요청서) ===')).toBeLessThan(r.text.indexOf('=== 파일: 뒤.hwp (제안요청서) ==='));
    expect(r.text).toContain('신용평가 | 10점');
    expect(r.text).toContain('--- 쪽 미상, 줄 1~4 ---');
    expect(r.truncated).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.files.map((f) => f.attachmentId)).toEqual(['b', 'a']);
    expect(r.chars).toBe(r.text.length);
  });
  it('총 상한을 넘으면 null', () => {
    const line = 'x'.repeat(1000);
    const big = Array.from({ length: API_FULLTEXT_MAX_CHARS / 1000 + 5 }, () => line).join('\n');
    expect(buildFullText({ files: [file(big)], synonyms: syn })).toBeNull();
  });
});

describe('buildExcerpt v2: 섹션·주석·참조어', () => {
  const synV2 = { ...syn, scoreHeader: ['배점'] };
  it('적중 줄이 속한 섹션의 머리 줄부터 포함한다(머리가 6줄보다 멀어도)', () => {
    const lines = [...filler(20, '앞'), '□ 가나다 구분', ...filler(12, '섹션내용'), '신용평가 10점', ...filler(50, '뒤')];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2 });
    expect(r.text).toContain('□ 가나다 구분');
    expect(r.text).not.toContain('앞19');
  });
  it('섹션은 상한(6,000자)까지만 확장한다', () => {
    const body = Array.from({ length: 200 }, (_, i) => `섹션본문${i} ${'가'.repeat(80)}`);
    const lines = ['□ 큰 섹션', ...body.slice(0, 10), '신용평가 10점', ...body.slice(10)];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2 });
    expect(r.text).toContain('□ 큰 섹션');
    expect(r.text).not.toContain('섹션본문199');
  });
  it('표 끝 뒤 ※·* 주석 줄을 표 구간에 포함한다', () => {
    const lines = ['[표 1]', '[셀 0 0] 신용평가', '[셀 0 1] 배점', '[셀 1 0] A', '[셀 1 1] 10점', '※ 주석 첫째', '* 주석 둘째', '주1) 주석 셋째', '일반 문장', ...filler(60)];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2 });
    expect(r.text).toContain('※ 주석 첫째');
    expect(r.text).toContain('주1) 주석 셋째');
  });
  it('평가표 셀의 * 기호 어구가 있으면 멀리 떨어진 * 정의 줄도 가져온다', () => {
    const far = [...filler(300, '먼'), '** 상한 정의 줄 입니다', '* 단일 별 정의 줄 입니다', ...filler(300, '끝')];
    const lines = ['[표 1]', '[셀 0 0] 신용평가', '[셀 0 1] 배점', '[셀 1 0] 경영상태**', '[셀 1 1] 10점', '[셀 2 0] 평가*', '[셀 2 1] 5점', ...far];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2 });
    expect(r.text).toContain('** 상한 정의 줄 입니다');
    expect(r.text).toContain('* 단일 별 정의 줄 입니다');
  });
  it('배점 열 표의 기호 붙은 명사구가 든 줄을 창[-2,+8]으로 가져온다', () => {
    const lines = ['[표 1]', '[셀 0 0] 구분', '[셀 0 1] 배점', '[셀 1 0] 특수전문가※', '[셀 1 1] 3점', ...filler(300, '먼'), '직전줄', '특수전문가 는 별도 기준으로 본다', '다음줄', ...filler(30, '끝')];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2 });
    expect(r.text).toContain('특수전문가 는 별도 기준으로 본다');
    expect(r.text).toContain('직전줄');
    expect(r.text).toContain('다음줄');
    expect(r.text).not.toContain('먼100');
  });
  it('keys가 1개여도 다른 항목 키워드 줄과 그 섹션 머리를 포함한다', () => {
    const lines = [...filler(20, '앞'), '□ 평가표 머리', ...filler(15, '내용'), '신용평가 10점', '경영상태 5점', ...filler(50, '뒤')];
    const r = buildExcerpt({ files: [file(lines.join('\n'))], synonyms: synV2, keys: ['credibilityScore'] });
    expect(r.text).toContain('□ 평가표 머리');
    expect(r.text).toContain('경영상태 5점');
  });
});
