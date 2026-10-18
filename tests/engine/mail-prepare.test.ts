import { describe, expect, it } from 'vitest';
import { renderMail } from '../../src/core/templates/render';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { Notice } from '../../src/core/types/notice';
import { saveGroup, saveRecipient, setDefaultGroup } from '../../src/engine/config/recipients-api';
import { listTemplates } from '../../src/engine/config/templates-api';
import { draftPath, draftToComposeFill, getDraft, prepareMail, setMailStatus } from '../../src/engine/mail/prepare';
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
    expect(await codeOf(setMailStatus(mem, { noticeId: 'R1-000', status: 'delivered' }, { ...opts, isBusy: () => true }))).toBe('JOB_ALREADY_RUNNING');
    expect(new Map(mem.files)).toEqual(before);
  });
  it('이미 delivered면 다시 준비해도 delivered를 유지한다', async () => {
    const { mem } = await setup();
    await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    await setMailStatus(mem, { noticeId: 'R1-000', status: 'delivered' }, opts);
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

describe('setMailStatus / getDraft', () => {
  it('delivered는 deliveredAt을 기록하고, none은 초안 유무로 drafting/none을 정한다', async () => {
    const { mem } = await setup();
    let { notice } = await setMailStatus(mem, { noticeId: 'R1-000', status: 'delivered' }, opts);
    expect(notice.mail).toMatchObject({ status: 'delivered', deliveredAt: NOW.toISOString() });
    ({ notice } = await setMailStatus(mem, { noticeId: 'R1-000', status: 'none' }, opts));
    expect(notice.mail.status).toBe('none');
    expect('deliveredAt' in notice.mail).toBe(false);
    await prepareMail(mem, { noticeId: 'R1-000' }, opts);
    await setMailStatus(mem, { noticeId: 'R1-000', status: 'delivered' }, opts);
    ({ notice } = await setMailStatus(mem, { noticeId: 'R1-000', status: 'none' }, opts));
    expect(notice.mail.status).toBe('drafting');
    expect(await codeOf(setMailStatus(mem, { noticeId: 'nope', status: 'none' }, opts))).toBe('NOT_FOUND');
  });
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
