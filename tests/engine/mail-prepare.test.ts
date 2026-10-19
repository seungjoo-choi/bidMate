import { describe, expect, it } from 'vitest';
import { renderMail } from '../../src/core/templates/render';
import { sampleNotice, samplePrespecNotice } from '../../src/core/templates/sample-notice';
import type { Notice } from '../../src/core/types/notice';
import { saveGroup, saveRecipient, setDefaultGroup } from '../../src/engine/config/recipients-api';
import { createMailEdits } from '../../src/core/mail/edits';
import type { MailEdits } from '../../src/core/types/mail';
import { deleteTemplate, listTemplates, saveTemplate } from '../../src/engine/config/templates-api';
import { draftPath, draftToComposeFill, getDraft, getEdits, prepareMail } from '../../src/engine/mail/prepare';
import { SentStore } from '../../src/engine/mail/sent-store';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => e.code as string);
const FOLDER = 'notices/2026/R1-000_가';
const NOW = new Date('2026-10-18T09:00:00.000Z');
const opts = { now: () => NOW };

async function setup(withGroup = true) {
  const mem = new MemoryStore();
  const n: Notice = sampleNotice();
  n.id = 'R1-000'; n.folder = FOLDER;
  n.attachments = [
    { id: 'a1', index: 0, originalName: '공고문.hwp', savedName: '공고문.hwp', url: '', expectedSize: 10, savedSize: 12, status: 'saved', attempts: 1 },
    { id: 'a2', index: 1, originalName: '실패.pdf', savedName: null, url: '', expectedSize: 5, savedSize: null, status: 'failed', attempts: 1 },
  ];
  await new NoticeStore(mem).saveNotice(n);
  let groupId = '';
  if (withGroup) {
    const r1 = (await saveRecipient(mem, { name: '가', email: 'a@x.com', enabled: true, defaultRole: 'to' })).recipients[0]!.id;
    const r2 = (await saveRecipient(mem, { name: '나', email: 'b@x.com', enabled: true, defaultRole: 'cc' })).recipients[1]!.id;
    groupId = (await saveGroup(mem, { name: '팀', memberIds: [r1, r2] })).groups.find((g) => g.name === '팀')!.id;
    await setDefaultGroup(mem, groupId);
  }
  return { mem, groupId };
}

describe('prepareMail', () => {
  it('기본 그룹/템플릿으로 초안을 만들고 notice.mail을 기록한다', async () => {
    const { mem, groupId } = await setup();
    const { draft, notice } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    expect(draft.to).toEqual(['a@x.com']);
    expect(draft.cc).toEqual(['b@x.com']);
    expect(draft.groupId).toBe(groupId);
    expect(draft.templateId).toBe('tpl_default');
    expect(draft.preparedAt).toBe(NOW.toISOString());
    expect(JSON.parse(await mem.readText(draftPath(FOLDER)))).toEqual(draft);
    expect(notice.mail).toMatchObject({ status: 'drafting', groupId, templateId: 'tpl_default' });
    expect(notice.mail.lastComposedAt).toBeUndefined();
    const disk = await new NoticeStore(mem).loadNotice('R1-000');
    expect(disk?.mail.status).toBe('drafting');
    expect((await new NoticeStore(mem).loadIndex()).notices[0]!.mailStatus).toBe('drafting');
    // 초안은 작성 이력(ComposeRecord)이 아니고, 템플릿 설정 파일도 새로 만들지 않는다(리뷰 지적).
    expect(mem.files.has(`${FOLDER}/mail.json`)).toBe(false);
    expect(mem.files.has('config/templates.json')).toBe(false);
  });
  it('초안은 renderMail 직접 호출 결과와 같다', async () => {
    const { mem } = await setup();
    const { draft, notice } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    const tpl = (await listTemplates(mem, opts)).templates[0]!;
    const r = renderMail(tpl, notice);
    expect({ subject: draft.subject, html: draft.html, text: draft.text, unresolved: draft.unresolved, unknownVars: draft.unknownVars })
      .toEqual({ subject: r.subject, html: r.html, text: r.text, unresolved: r.unresolved, unknownVars: r.unknownVars });
  });
  it('groupId를 지정하면 기본 그룹보다 우선하고 없는 그룹은 GROUP_NOT_FOUND', async () => {
    const { mem } = await setup();
    const rid = (await saveRecipient(mem, { name: '다', email: 'c@x.com', enabled: true, defaultRole: 'to' })).recipients[2]!.id;
    const g2 = (await saveGroup(mem, { name: '다른팀', memberIds: [rid] })).groups.find((g) => g.name === '다른팀')!.id;
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', groupId: g2 }, opts);
    expect(draft.to).toEqual(['c@x.com']);
    expect(draft.groupId).toBe(g2);
    // 이후엔 notice.mail.groupId가 기본 그룹보다 우선
    expect((await prepareMail(mem, { noticeId: 'R1-000' }, opts)).draft.groupId).toBe(g2);
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', groupId: 'nope' }, opts))).toBe('GROUP_NOT_FOUND');
    expect(await codeOf(prepareMail(mem, { noticeId: 'nope' }, opts))).toBe('NOT_FOUND');
  });
  it('그룹이 없으면 NO_GROUP', async () => {
    const { mem } = await setup(false);
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000' }, opts))).toBe('NO_GROUP');
    expect(mem.files.has(draftPath(FOLDER))).toBe(false);
  });
  it('해석된 수신자가 0명이면 NO_RECIPIENTS', async () => {
    const { mem } = await setup(false);
    await saveGroup(mem, { name: '빈 그룹', memberIds: [] });
    const gid = (await saveGroup(mem, { name: '빈 그룹2', memberIds: [] })).groups[1]!.id;
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', groupId: gid }, opts))).toBe('NO_RECIPIENTS');
    expect(mem.files.has(draftPath(FOLDER))).toBe(false);
  });
  it('저장된 첨부와 아닌 첨부를 분리하고 warning을 남긴다', async () => {
    const { mem } = await setup();
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    expect(draft.attachments).toEqual([{ attachmentId: 'a1', name: '공고문.hwp', path: `${FOLDER}/attachments/공고문.hwp`, size: 12 }]);
    expect(draft.skippedAttachments).toEqual([{ attachmentId: 'a2', name: '실패.pdf', status: 'failed' }]);
    expect(draft.warnings).toContain('첨부 1개가 저장되지 않았습니다');
  });
  it('isBusy면 JOB_ALREADY_RUNNING이고 파일이 바뀌지 않는다', async () => {
    const { mem } = await setup();
    const before = new Map(mem.files);
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000' }, { ...opts, isBusy: () => true }))).toBe('JOB_ALREADY_RUNNING');
    expect(new Map(mem.files)).toEqual(before);
  });
  it('이미 delivered면 다시 준비해도 delivered를 유지한다', async () => {
    const { mem } = await setup();
    await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    await new SentStore(mem).addManual({ noticeId: 'R1-000' }, NOW);
    const { notice } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    expect(notice.mail.status).toBe('delivered');
  });
});

describe('prepareMail recipients(합성 그룹)', () => {
  async function addRecipients(mem: MemoryStore) {
    const ids: string[] = [];
    for (const [n, e, r] of [['다', 'c@x.com', 'to'], ['라', 'd@x.com', 'to'], ['마', 'e@x.com', 'to']] as const) {
      const rs = (await saveRecipient(mem, { name: n, email: e, enabled: true, defaultRole: r })).recipients;
      ids.push(rs[rs.length - 1]!.id);
    }
    return ids;
  }
  it('역할을 덮어쓰고 중복 id를 제거하며 groupId는 생략, notice.mail.groupId는 유지', async () => {
    const { mem, groupId } = await setup();
    const [c, d, c2] = await addRecipients(mem);
    await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    const { draft, notice } = await prepareMail(mem, { noticeId: 'R1-000', recipients: [
      { recipientId: c!, role: 'cc' }, { recipientId: d!, role: 'to' }, { recipientId: c2!, role: 'to' }, { recipientId: d!, role: 'cc' },
    ] }, opts);
    expect(draft.to).toEqual(['d@x.com', 'e@x.com']);
    expect(draft.cc).toEqual(['c@x.com']);
    expect(draft.groupId).toBeUndefined();
    expect(draft.recipientSource).toBe('custom');
    expect(notice.mail.groupId).toBe(groupId);
  });
  it('일부 삭제/사용 안 함이면 경고, 전원이면 NO_RECIPIENTS, 빈 배열도 NO_RECIPIENTS', async () => {
    const { mem } = await setup();
    const [c] = await addRecipients(mem);
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', recipients: [{ recipientId: c!, role: 'to' }, { recipientId: 'gone', role: 'cc' }] }, opts);
    expect(draft.to).toEqual(['c@x.com']);
    expect(draft.warnings).toContain('삭제되거나 사용 안 함인 수신자 1명 제외');
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', recipients: [{ recipientId: 'gone', role: 'to' }] }, opts))).toBe('NO_RECIPIENTS');
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', recipients: [] }, opts))).toBe('NO_RECIPIENTS');
  });
  it('GROUP_NOT_FOUND / TEMPLATE_NOT_FOUND', async () => {
    const { mem } = await setup();
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', groupId: 'nope' }, opts))).toBe('GROUP_NOT_FOUND');
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', templateId: 'nope' }, opts))).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('getDraft', () => {
  it('getDraft는 초안을 돌려주고, 없거나 손상되면 null', async () => {
    const { mem } = await setup();
    expect(await getDraft(mem, 'R1-000')).toBeNull();
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    expect(await getDraft(mem, 'R1-000')).toEqual(draft);
    await mem.writeText(draftPath(FOLDER), '{broken');
    expect(await getDraft(mem, 'R1-000')).toBeNull();
    await mem.writeText(draftPath(FOLDER), '[]');
    expect(await getDraft(mem, 'R1-000')).toBeNull();
    expect(await getDraft(mem, 'nope')).toBeNull();
  });
});

describe('draftToComposeFill', () => {
  it('fill 입력과 FileMeta[]로 변환한다', async () => {
    const { mem } = await setup();
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    const { fill, files } = draftToComposeFill(draft);
    expect(fill).toEqual({ to: draft.to, cc: draft.cc, subject: draft.subject, html: draft.html });
    expect(files).toEqual([{ fileId: 'a1', name: '공고문.hwp', size: 12 }]);
  });
});

describe('prepareMail 공고별 편집(edits)', () => {
  const EDITS_FILE = `${FOLDER}/mail-edits.json`;
  async function baseEdits(mem: MemoryStore, tplId = 'tpl_default') {
    const tpl = (await listTemplates(mem, opts)).templates.find((t) => t.id === tplId)!;
    return createMailEdits('R1-000', tpl, NOW);
  }
  function setPm(e: MailEdits, text: string) {
    const item = e.template.sections.flatMap((s) => s.items).find((i) => i.kind === 'text' && i.id === 'txt_pm');
    if (!item || item.kind !== 'text') throw new Error('txt_pm 없음');
    item.text = text;
  }
  async function customTemplate(mem: MemoryStore) {
    const t = (await saveTemplate(mem, { name: '내 양식', kind: 'bid', subject: '원본 제목', greeting: '', closing: '', layout: 'list', sections: [] }, opts)).templates.find((x) => x.name === '내 양식')!;
    return t;
  }

  it('복사본으로 렌더하고 draft.edited를 남긴다', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    setPm(e, '홍길동PM');
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    expect(draft.html).toContain('홍길동PM');
    expect(draft.edited).toEqual({ at: e.updatedAt });
    expect(draft.templateId).toBe('tpl_default');
    expect(mem.files.has(EDITS_FILE)).toBe(true);
    expect((await getEdits(mem, 'R1-000'))?.noticeId).toBe('R1-000');
    // edits 없이 다시 준비해도 저장된 편집을 쓴다
    expect((await prepareMail(mem, { noticeId: 'R1-000' }, opts)).draft.html).toContain('홍길동PM');
  });
  it('요청 templateId가 다르면 편집 우선 warning', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    e.template.subject = '복사본 제목';
    await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', templateId: 'tpl_prespec_default' }, opts);
    expect(draft.subject).toBe('복사본 제목');
    expect(draft.templateId).toBe('tpl_default');
    expect(draft.warnings).toContain(`이 공고 전용 양식(템플릿 '${e.base.templateName}' 기준)을 사용했습니다. 요청한 템플릿은 적용하지 않았습니다`);
  });
  it('edits:null이면 파일을 삭제하고 기존 규칙으로 렌더한다', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    setPm(e, '홍길동PM');
    await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', edits: null }, opts);
    expect(mem.files.has(EDITS_FILE)).toBe(false);
    expect(draft.html).not.toContain('홍길동PM');
    expect(draft.edited).toBeUndefined();
    expect(await getEdits(mem, 'R1-000')).toBeNull();
    // 파일이 없어도 null은 무시된다
    await prepareMail(mem, { noticeId: 'R1-000', edits: null }, opts);
  });
  it('수신자 덮어쓰기: 그룹이 없어도 성공하고 edited, 0명이면 NO_RECIPIENTS', async () => {
    const { mem } = await setup(false);
    const e = await baseEdits(mem);
    e.recipients = { to: [' X@x.com ', 'y@x.com'], cc: ['x@x.com', 'z@x.com'] };
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    expect(draft.to).toEqual(['x@x.com', 'y@x.com']);
    expect(draft.cc).toEqual(['z@x.com']);
    expect(draft.recipientSource).toBe('edited');
    expect(draft.groupId).toBeUndefined();
    e.recipients = { to: ['', '  '], cc: [] };
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts))).toBe('NO_RECIPIENTS');
  });
  it('첨부 제외는 excludedAttachments에 기록하고 모르는 id는 무시', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    e.excludedAttachmentIds = ['a1', 'zzz'];
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    expect(draft.attachments).toEqual([]);
    expect(draft.excludedAttachments).toEqual([{ attachmentId: 'a1', name: '공고문.hwp' }]);
    expect(draft.skippedAttachments).toEqual([{ attachmentId: 'a2', name: '실패.pdf', status: 'failed' }]);
    e.excludedAttachmentIds = ['zzz'];
    const d2 = (await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts)).draft;
    expect(d2.attachments).toHaveLength(1);
    expect(d2.excludedAttachments).toBeUndefined();
  });
  it('원본 템플릿이 변경되면 warning, 삭제되면 복사본으로 계속 동작하며 warning', async () => {
    const { mem } = await setup();
    const mine = await customTemplate(mem);
    const e = await baseEdits(mem, mine.id);
    await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    await saveTemplate(mem, { id: mine.id, name: '내 양식', subject: '바뀐 제목', greeting: '', closing: '', layout: 'list', sections: [] }, { now: () => new Date('2026-10-19T00:00:00.000Z') });
    const changed = (await prepareMail(mem, { noticeId: 'R1-000' }, opts)).draft;
    expect(changed.warnings).toContain('원본 템플릿이 변경되었습니다. 이 공고 양식은 저장 당시 복사본입니다');
    expect(changed.subject).toBe('원본 제목');
    await deleteTemplate(mem, mine.id, opts);
    const gone = (await prepareMail(mem, { noticeId: 'R1-000' }, opts)).draft;
    expect(gone.warnings).toContain('원본 템플릿이 삭제되었습니다');
    expect(gone.subject).toBe('원본 제목');
  });
  it('손상된 편집 파일은 무시하고 warning, 삭제하지 않는다', async () => {
    const { mem } = await setup();
    await mem.writeText(EDITS_FILE, '{broken');
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    expect(draft.warnings).toContain('편집 파일이 손상되어 무시했습니다');
    expect(draft.edited).toBeUndefined();
    expect(draft.templateId).toBe('tpl_default');
    expect(mem.files.has(EDITS_FILE)).toBe(true);
  });
  it('edits:null에서 remove가 NotFoundError를 던져도 성공한다', async () => {
    const { mem } = await setup();
    mem.remove = async () => { throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); };
    const { draft } = await prepareMail(mem, { noticeId: 'R1-000', edits: null }, opts);
    expect(draft.edited).toBeUndefined();
  });
  it('검사 실패 시 편집 파일은 이전 상태 그대로다', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    setPm(e, '홍길동PM');
    await prepareMail(mem, { noticeId: 'R1-000', edits: e }, opts);
    const before = await mem.readText(EDITS_FILE);
    const bad = await baseEdits(mem);
    bad.recipients = { to: [], cc: [] };
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', edits: bad }, opts))).toBe('NO_RECIPIENTS');
    expect(await mem.readText(EDITS_FILE)).toBe(before);
    expect((await getEdits(mem, 'R1-000'))?.recipients).toBeUndefined();
    // edits:null 요청이 다른 이유로 실패하면 삭제되지 않는다
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', edits: null, groupId: 'nope' }, opts))).toBe('GROUP_NOT_FOUND');
    expect(await mem.readText(EDITS_FILE)).toBe(before);
  });
  it('edits.noticeId가 다르거나 형식이 틀리면 INVALID_VALUE이고 저장하지 않는다', async () => {
    const { mem } = await setup();
    const e = await baseEdits(mem);
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', edits: { ...e, noticeId: 'other' } }, opts))).toBe('INVALID_VALUE');
    expect(await codeOf(prepareMail(mem, { noticeId: 'R1-000', edits: { schemaVersion: 2 } as unknown as MailEdits }, opts))).toBe('INVALID_VALUE');
    expect(mem.files.has(EDITS_FILE)).toBe(false);
  });
});

describe('prepareMail 템플릿 종류', () => {
  async function setupPrespec() {
    const { mem } = await setup();
    const n = samplePrespecNotice();
    n.id = 'R26BD00273952'; n.folder = 'notices/2026/R26BD00273952_가';
    await new NoticeStore(mem).saveNotice(n);
    return mem;
  }
  it('사전규격 공고는 사전규격 기본 템플릿을 고르고 warning이 없다', async () => {
    const mem = await setupPrespec();
    const { draft } = await prepareMail(mem, { noticeId: 'R26BD00273952' }, opts);
    expect(draft.templateId).toBe('tpl_prespec_default');
    expect(draft.warnings.some((w) => w.includes('템플릿 종류'))).toBe(false);
  });
  it('bid 공고는 여전히 bid 기본 템플릿을 고른다', async () => {
    const { mem } = await setup();
    expect((await prepareMail(mem, { noticeId: 'R1-000' }, opts)).draft.templateId).toBe('tpl_default');
  });
  it('종류가 다른 템플릿을 지정하면 warning을 남기고 진행한다', async () => {
    const mem = await setupPrespec();
    const { draft } = await prepareMail(mem, { noticeId: 'R26BD00273952', templateId: 'tpl_default' }, opts);
    expect(draft.templateId).toBe('tpl_default');
    expect(draft.warnings).toContain('템플릿 종류(입찰공고)가 공고 종류(사전규격)와 다릅니다');
    const { mem: m2 } = await setup();
    const { draft: d2 } = await prepareMail(m2, { noticeId: 'R1-000', templateId: 'tpl_prespec_default' }, opts);
    expect(d2.warnings).toContain('템플릿 종류(사전규격)가 공고 종류(입찰공고)와 다릅니다');
  });
  it('notice.mail.templateId가 종류 기본보다 우선한다', async () => {
    const mem = await setupPrespec();
    const mine = (await saveTemplate(mem, { name: '내 사전규격', kind: 'prespec', subject: 's', greeting: '', closing: '', layout: 'list', sections: [] }, opts)).templates.find((t) => t.name === '내 사전규격')!;
    await prepareMail(mem, { noticeId: 'R26BD00273952', templateId: mine.id }, opts);
    expect((await prepareMail(mem, { noticeId: 'R26BD00273952' }, opts)).draft.templateId).toBe(mine.id);
  });
});
