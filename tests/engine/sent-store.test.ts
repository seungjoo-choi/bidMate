import { describe, expect, it } from 'vitest';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { ComposeRecord, SendRecord } from '../../src/core/types/compose';
import type { Notice } from '../../src/core/types/notice';
import { draftPath } from '../../src/engine/mail/prepare';
import { SENT_INDEX_PATH, SentStore, sentPath } from '../../src/engine/mail/sent-store';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/R1-000_가';
const T0 = new Date('2026-10-18T09:00:00.000Z');
const T1 = new Date('2026-10-19T09:00:00.000Z');

async function setup(mail?: Notice['mail']) {
  const mem = new MemoryStore();
  const n = sampleNotice();
  n.id = 'R1-000'; n.folder = FOLDER;
  if (mail) n.mail = mail;
  await new NoticeStore(mem).saveNotice(n);
  return { mem, ss: new SentStore(mem), ns: new NoticeStore(mem) };
}
const compose = (id: string, composedAt: string): ComposeRecord => ({
  id, jobId: 'job1', noticeId: 'R1-000', composedAt, templateId: 't', snapshot: { to: ['a'], cc: [], subject: '제목', html: '' },
  fields: [], attachments: [], outcome: 'ready_for_review', adapterId: 'a', selectorSetVersion: 'v', webmailUrl: '',
});

describe('SentStore 수동 기록/취소', () => {
  it('2회 추가하면 기록 2개, notice는 delivered/sentCount 2, index 2행', async () => {
    const { ss, ns } = await setup();
    await ss.addManual({ noticeId: 'R1-000' }, T0);
    const { notice } = await ss.addManual({ noticeId: 'R1-000', sentAt: '2026-10-19T00:00:00.000Z', note: ' 메모 ' }, T1);
    expect(notice.mail).toMatchObject({ status: 'delivered', sentCount: 2, deliveredAt: '2026-10-19T00:00:00.000Z' });
    expect((await ns.loadNotice('R1-000'))!.mail.sentCount).toBe(2);
    const list = await ss.list('R1-000');
    expect(list).toHaveLength(2);
    expect(list[1]!.note).toBe('메모');
    expect((await ss.loadIndex()).entries).toHaveLength(2);
  });
  it('잘못된 sentAt과 없는 공고', async () => {
    const { ss } = await setup();
    await expect(ss.addManual({ noticeId: 'R1-000', sentAt: 'zzz' }, T0)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(ss.addManual({ noticeId: 'nope' }, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('작성 기록이 마지막 발송보다 뒤면 귀속하고, 아니면 귀속하지 않는다', async () => {
    const { mem, ss } = await setup();
    await mem.writeText(`${FOLDER}/mail.json`, JSON.stringify([compose('job1-1', '2026-10-18T08:00:00.000Z')]));
    const a = await ss.addManual({ noticeId: 'R1-000' }, T0);
    expect(a.record).toMatchObject({ composeRecordId: 'job1-1', jobId: 'job1' });
    expect(a.record.summary.subject).toBe('제목');
    const b = await ss.addManual({ noticeId: 'R1-000' }, T1);
    expect(b.record.composeRecordId).toBeUndefined();
  });
  it('취소하면 유효 기록이 없을 때 none/drafting으로 돌아간다', async () => {
    const { mem, ss } = await setup();
    const { record } = await ss.addManual({ noticeId: 'R1-000' }, T0);
    let { notice } = await ss.voidRecord({ noticeId: 'R1-000', recordId: record.id }, T1);
    expect(notice.mail.status).toBe('none');
    expect('deliveredAt' in notice.mail).toBe(false);
    expect((await ss.list('R1-000'))[0]!.voidedAt).toBe(T1.toISOString());
    expect((await ss.loadIndex()).entries[0]!.voidedAt).toBe(T1.toISOString());
    await mem.writeText(draftPath(FOLDER), JSON.stringify({ schemaVersion: 1, to: [], cc: [], attachments: [], subject: 's', html: '' }));
    const r2 = await ss.addManual({ noticeId: 'R1-000' }, T1);
    ({ notice } = await ss.voidRecord({ noticeId: 'R1-000', recordId: r2.record.id }, T1));
    expect(notice.mail.status).toBe('drafting');
    await expect(ss.voidRecord({ noticeId: 'R1-000', recordId: 'zzz' }, T1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('SentStore legacy', () => {
  const legacyMail = { status: 'delivered' as const, deliveredAt: '2026-10-01T00:00:00.000Z' };
  it('옛 delivered 공고는 list에서 legacy 1건, 파일은 만들지 않는다', async () => {
    const { mem, ss } = await setup(legacyMail);
    const list = await ss.list('R1-000');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'legacy-R1-000', source: 'manual', sentAt: legacyMail.deliveredAt });
    expect(mem.files.has(sentPath(FOLDER))).toBe(false);
    expect((await ss.loadIndex()).entries.map((e) => e.id)).toEqual(['legacy-R1-000']);
  });
  it('voidRecord(legacy)하면 물질화되고 notice.mail이 none으로 돌아간다', async () => {
    const { mem, ss } = await setup(legacyMail);
    const { notice } = await ss.voidRecord({ noticeId: 'R1-000', recordId: 'legacy-R1-000' }, T0);
    expect(notice.mail.status).toBe('none');
    const saved = JSON.parse(String(mem.files.get(sentPath(FOLDER)))) as SendRecord[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.voidedAt).toBe(T0.toISOString());
  });
  it('legacy가 있는 공고에 추가하면 legacy도 함께 물질화된다', async () => {
    const { ss } = await setup(legacyMail);
    const { notice } = await ss.addManual({ noticeId: 'R1-000' }, T0);
    expect(notice.mail.sentCount).toBe(2);
    expect((await ss.list('R1-000')).map((r) => r.id)).toContain('legacy-R1-000');
  });
});

describe('SentStore 자동 기록', () => {
  it('recordAuto는 기록을 만들고 같은 composeRecordId의 두 번째 신호는 null', async () => {
    const { mem, ss } = await setup();
    await mem.writeText(`${FOLDER}/mail.json`, JSON.stringify([compose('job1-1', '2026-10-18T08:00:00.000Z')]));
    const p = { noticeId: 'R1-000', jobId: 'job1', composeRecordId: 'job1-1', provider: 'naverworks' as const, kind: 'click' as const };
    const a = await ss.recordAuto(p, T0);
    expect(a.record).toMatchObject({ source: 'auto', composeRecordId: 'job1-1', signal: { kind: 'click', confirmed: false }, provider: 'naverworks' });
    expect((await ss.recordAuto({ ...p, kind: 'hotkey' }, T1)).record).toBeNull();
    expect(await ss.list('R1-000')).toHaveLength(1);
  });
  it('수동 기록이 같은 composeRecordId를 가졌거나 취소된 기록이면 auto는 버린다', async () => {
    const { mem, ss } = await setup();
    await mem.writeText(`${FOLDER}/mail.json`, JSON.stringify([compose('job1-1', '2026-10-18T08:00:00.000Z')]));
    const { record } = await ss.addManual({ noticeId: 'R1-000' }, T0);
    const p = { noticeId: 'R1-000', jobId: 'job1', composeRecordId: 'job1-1', kind: 'click' as const };
    expect((await ss.recordAuto(p, T1)).record).toBeNull();
    await ss.voidRecord({ noticeId: 'R1-000', recordId: record.id }, T1);
    expect((await ss.recordAuto(p, T1)).record).toBeNull();
  });
  it('confirmAuto는 signal을 갱신하고, 대상이 없으면 무시한다', async () => {
    const { ss } = await setup();
    await ss.confirmAuto({ noticeId: 'R1-000', jobId: 'job1', composeRecordId: 'x', confirmation: 'toast' });
    await ss.confirmAuto({ noticeId: 'nope', jobId: 'job1', confirmation: 'toast' });
    await ss.recordAuto({ noticeId: 'R1-000', jobId: 'job1', composeRecordId: 'x', kind: 'hotkey' }, T0);
    await ss.confirmAuto({ noticeId: 'R1-000', jobId: 'job1', composeRecordId: 'x', confirmation: 'ui_gone' });
    expect((await ss.list('R1-000'))[0]!.signal).toEqual({ kind: 'hotkey', confirmed: true, confirmation: 'ui_gone' });
    expect((await ss.loadIndex()).entries[0]!.confirmed).toBe(true);
  });
  it('composeRecordId가 없으면 같은 jobId의 auto 기록 중복을 버린다', async () => {
    const { ss } = await setup();
    const p = { noticeId: 'R1-000', jobId: 'job1', kind: 'click' as const };
    expect((await ss.recordAuto(p, T0)).record).not.toBeNull();
    expect((await ss.recordAuto(p, T1)).record).toBeNull();
  });
});

describe('SentStore index 재생성', () => {
  it('index가 없거나 손상되면 공고를 돌며 재생성한다', async () => {
    const { mem, ss } = await setup();
    await ss.addManual({ noticeId: 'R1-000' }, T0);
    await ss.addManual({ noticeId: 'R1-000' }, T1);
    await mem.remove(SENT_INDEX_PATH);
    expect((await ss.loadIndex()).entries).toHaveLength(2);
    await mem.writeText(SENT_INDEX_PATH, '{broken');
    const idx = await ss.loadIndex();
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries[0]).toMatchObject({ noticeId: 'R1-000', folder: FOLDER });
  });
});

describe('SentStore 보호', () => {
  it('isBusy면 addManual/voidRecord는 JOB_ALREADY_RUNNING이고 파일이 바뀌지 않는다', async () => {
    const { mem } = await setup();
    const ok = new SentStore(mem);
    const { record } = await ok.addManual({ noticeId: 'R1-000' }, T0);
    const busy = new SentStore(mem, { isBusy: () => true });
    const before = new Map(mem.files);
    await expect(busy.addManual({ noticeId: 'R1-000' }, T1)).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    await expect(busy.voidRecord({ noticeId: 'R1-000', recordId: record.id }, T1)).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
    expect(new Map(mem.files)).toEqual(before);
    expect((await busy.recordAuto({ noticeId: 'R1-000', jobId: 'j', kind: 'click' }, T1)).record).not.toBeNull();
  });
  it('mail-sent.json이 손상되면 쓰기 경로는 오류를 던지고 파일을 건드리지 않으며, list는 빈 값', async () => {
    const { mem, ss } = await setup();
    await mem.writeText(sentPath(FOLDER), '{broken');
    const before = new Map(mem.files);
    await expect(ss.addManual({ noticeId: 'R1-000' }, T0)).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' });
    await expect(ss.recordAuto({ noticeId: 'R1-000', jobId: 'j', kind: 'click' }, T0)).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' });
    await expect(ss.voidRecord({ noticeId: 'R1-000', recordId: 'x' }, T0)).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' });
    await expect(ss.confirmAuto({ noticeId: 'R1-000', jobId: 'j', confirmation: 'toast' })).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' });
    expect(new Map(mem.files)).toEqual(before);
    expect(await ss.list('R1-000')).toEqual([]);
  });
  it('index 쓰기 실패 + remove 성공이면 정상 반환하고 notice는 delivered, 다음 loadIndex가 재생성한다', async () => {
    const { mem, ss, ns } = await setup();
    await ss.addManual({ noticeId: 'R1-000' }, T0);
    const orig = mem.writeText.bind(mem);
    mem.writeText = async (p: string, t: string) => {
      if (p === SENT_INDEX_PATH) throw Object.assign(new Error('x'), { code: 'DISK_FULL' });
      return orig(p, t);
    };
    const r = await ss.addManual({ noticeId: 'R1-000' }, T1);
    mem.writeText = orig;
    expect(r.notice.mail).toMatchObject({ status: 'delivered', sentCount: 2 });
    expect((await ns.loadNotice('R1-000'))!.mail.status).toBe('delivered');
    expect(mem.files.has(SENT_INDEX_PATH)).toBe(false);
    expect((await ss.loadIndex()).entries).toHaveLength(2);
  });
  it('index 쓰기 실패 + remove 실패면 notice 저장 뒤 원래 오류를 던진다', async () => {
    const { mem, ss, ns } = await setup();
    const origW = mem.writeText.bind(mem);
    const origR = mem.remove.bind(mem);
    mem.writeText = async (p: string, t: string) => {
      if (p === SENT_INDEX_PATH) throw Object.assign(new Error('x'), { code: 'DISK_FULL' });
      return origW(p, t);
    };
    mem.remove = async () => { throw new Error('rm'); };
    await expect(ss.addManual({ noticeId: 'R1-000' }, T1)).rejects.toMatchObject({ code: 'DISK_FULL' });
    mem.writeText = origW;
    mem.remove = origR;
    expect((await ns.loadNotice('R1-000'))!.mail.status).toBe('delivered');
  });
});
