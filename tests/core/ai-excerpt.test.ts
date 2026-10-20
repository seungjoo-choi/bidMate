import { describe, expect, it } from 'vitest';
import { buildExcerpt, type ExcerptFileInput } from '../../src/core/ai/excerpt';
import { EXCERPT_FILE_MAX_CHARS, EXCERPT_MAX_CHARS } from '../../src/core/ai/constants';

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
    const r = buildExcerpt({ files: files.slice().reverse(), synonyms: syn });
    expect(r.chars).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
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
    const r = buildExcerpt({ files, synonyms: syn });
    expect(r.chars).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
    expect(r.files.map((f) => f.name)).toEqual(['f1.hwp', 'f2.hwp', 'f3.hwp']);
    expect(r.files[0]!.truncated).toBe(false);
    ['P1구간0', 'P1구간1', 'P1구간2'].forEach((t) => expect(r.text).toContain(t));
    expect(r.text).not.toContain('P4');
    expect(r.warnings.some((w) => w.includes('f4.hwp'))).toBe(true);
  });

  it('파일 상한 warning과 총 상한 warning을 각각 기록한다', () => {
    const big = (tag: string) => [`신용평가 ${tag}`, ...Array.from({ length: 70 }, () => '다'.repeat(600))].join('\n');
    const files = [1, 2, 3, 4].map((p) => file(big(`Q${p}`), { attachmentId: `a${p}`, name: `g${p}.hwp`, priority: p }));
    const r = buildExcerpt({ files, synonyms: syn });
    expect(r.warnings.some((w) => w.includes('파일 발췌 상한'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('총 발췌 상한'))).toBe(true);
  });

  it('입력에 없는 추출값은 출력에 나타나지 않는다(텍스트·파일 정보만 사용)', () => {
    const r = buildExcerpt({ files: [file('신용평가 10점')], synonyms: syn });
    expect(Object.keys(r).sort()).toEqual(['chars', 'files', 'text', 'truncated', 'warnings']);
    expect(r.files[0]).toEqual({ attachmentId: 'a1', sourceFile: 'a1.hwp', name: '제안요청서.hwp', chars: r.files[0]!.chars, truncated: false });
  });
});
