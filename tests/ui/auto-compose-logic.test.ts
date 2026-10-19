import { describe, expect, it, vi } from 'vitest';
import { countRoles, findBroken, requestToEnable, sanitizeForSave } from '../../src/entrypoints/dashboard/auto-compose-logic';
import { parseRoute, settingsSectionOf } from '../../src/entrypoints/dashboard/route';
import type { Group, Recipient } from '../../src/core/types/recipient';
import type { Template } from '../../src/core/types/template';
import type { AutoComposeSettings } from '../../src/core/types/settings';

const rc = (id: string, enabled = true): Recipient => ({ id, name: id, email: `${id}@x.kr`, enabled, defaultRole: 'to', updatedAt: '' });
const grp = { id: 'g1', name: 'g', memberIds: [], isDefault: true, updatedAt: '' } as Group;
const tpl = { id: 't1' } as Template;
const base: AutoComposeSettings = { enabled: true, afterCollect: 'compose', recipients: { mode: 'default' }, reviewGate: 'conflicts' };

describe('sanitizeForSave', () => {
  it('끊어진 수신자 id를 제거한다', () => {
    const s: AutoComposeSettings = { ...base, recipients: { mode: 'custom', members: [{ recipientId: 'a', role: 'to' }, { recipientId: 'x', role: 'cc' }] } };
    const r = sanitizeForSave(s, [grp], [rc('a')], [tpl]);
    expect(r).toEqual({ ok: true, removedMembers: 1, value: { ...base, recipients: { mode: 'custom', members: [{ recipientId: 'a', role: 'to' }] } } });
  });
  it('끊어진 그룹 id는 저장을 막는다', () => {
    const r = sanitizeForSave({ ...base, recipients: { mode: 'group', groupId: 'gone' } }, [grp], [], [tpl]);
    expect(r.ok).toBe(false);
  });
  it('끊어진 템플릿 id는 저장을 막는다', () => {
    expect(sanitizeForSave({ ...base, templateId: 'gone' }, [grp], [], [tpl]).ok).toBe(false);
    expect(sanitizeForSave({ ...base, templateId: 't1' }, [grp], [], [tpl]).ok).toBe(true);
  });
  it('findBroken', () => {
    expect(findBroken(base, [grp], [], [tpl])).toEqual({ groupMissing: false, templateMissing: false, prespecTemplateMissing: false, memberIds: [] });
  });
});

describe('countRoles', () => {
  it('사용 안 함과 없는 수신자는 세지 않는다', () => {
    const m = [{ recipientId: 'a', role: 'to' as const }, { recipientId: 'b', role: 'cc' as const }, { recipientId: 'c', role: 'cc' as const }, { recipientId: 'z', role: 'to' as const }];
    expect(countRoles(m, [rc('a'), rc('b'), rc('c', false)])).toEqual({ to: 1, cc: 1 });
  });
});

describe('requestToEnable', () => {
  it('거부되면 false', async () => {
    expect(await requestToEnable('https://m/*', vi.fn().mockResolvedValue(false))).toBe(false);
    expect(await requestToEnable('https://m/*', vi.fn().mockRejectedValue(new Error('x')))).toBe(false);
  });
  it('허용되면 true, origin 전달', async () => {
    const req = vi.fn().mockResolvedValue(true);
    expect(await requestToEnable('https://m/*', req)).toBe(true);
    expect(req).toHaveBeenCalledWith({ origins: ['https://m/*'] });
  });
});

describe('parseRoute query', () => {
  it('review 해시의 쿼리를 분리한다', () => {
    expect(parseRoute('#/review/a%2Fb?handoff=attachments_failed,needs_review')).toEqual({
      page: 'review', noticeId: 'a/b', query: { handoff: 'attachments_failed,needs_review' },
    });
  });
  it('mail 해시, 쿼리 없음', () => {
    expect(parseRoute('#/mail/n1')).toEqual({ page: 'mail', noticeId: 'n1', query: {} });
  });
});

describe('settingsSectionOf', () => {
  it('설정 해시의 section만 꺼내고 모르는 값은 버린다', () => {
    expect(parseRoute('#/settings?section=storage')).toEqual({ page: 'settings' });
    expect(settingsSectionOf('#/settings?section=auto-compose')).toBe('auto-compose');
    expect(settingsSectionOf('#/settings?section=nope')).toBeUndefined();
    expect(settingsSectionOf('#/settings')).toBeUndefined();
  });
});

describe('prespecTemplateId 끊어짐', () => {
  it('findBroken이 prespecTemplateMissing을 표시한다', () => {
    expect(findBroken({ ...base, prespecTemplateId: 'gone' }, [grp], [], [tpl]).prespecTemplateMissing).toBe(true);
    expect(findBroken({ ...base, prespecTemplateId: 't1' }, [grp], [], [tpl]).prespecTemplateMissing).toBe(false);
  });
  it('끊어진 사전규격 템플릿 id는 저장을 막는다', () => {
    expect(sanitizeForSave({ ...base, prespecTemplateId: 'gone' }, [grp], [], [tpl]).ok).toBe(false);
    expect(sanitizeForSave({ ...base, prespecTemplateId: 't1' }, [grp], [], [tpl]).ok).toBe(true);
  });
});
