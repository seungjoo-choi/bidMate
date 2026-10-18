import type { Group, Recipient } from '../../core/types/recipient';
import type { Template } from '../../core/types/template';
import type { AutoComposeSettings } from '../../core/types/settings';

export type BrokenReport = { groupMissing: boolean; templateMissing: boolean; memberIds: string[] };

/** 설정이 참조하는 id 중 목록에 없는 것을 찾는다. */
export function findBroken(s: AutoComposeSettings, groups: Group[], recipients: Recipient[], templates: Template[]): BrokenReport {
  const r = s.recipients;
  return {
    groupMissing: r.mode === 'group' && !groups.some((g) => g.id === r.groupId),
    templateMissing: !!s.templateId && !templates.some((t) => t.id === s.templateId),
    memberIds: r.mode === 'custom' ? r.members.filter((m) => !recipients.some((x) => x.id === m.recipientId)).map((m) => m.recipientId) : [],
  };
}

export type SanitizeResult =
  | { ok: true; value: AutoComposeSettings; removedMembers: number }
  | { ok: false; message: string };

/** 저장 직전 정리. 끊어진 수신자 id는 제거하고, 그룹/템플릿 id가 끊어져 있으면 저장을 막는다. */
export function sanitizeForSave(s: AutoComposeSettings, groups: Group[], recipients: Recipient[], templates: Template[]): SanitizeResult {
  const b = findBroken(s, groups, recipients, templates);
  if (b.groupMissing) return { ok: false, message: '선택한 수신 그룹이 삭제되었습니다. 다른 그룹을 선택해 주세요.' };
  if (b.templateMissing) return { ok: false, message: '선택한 템플릿이 삭제되었습니다. 다른 템플릿을 선택하거나 비워 주세요.' };
  if (s.recipients.mode === 'custom') {
    const members = s.recipients.members.filter((m) => !b.memberIds.includes(m.recipientId));
    return { ok: true, value: { ...s, recipients: { mode: 'custom', members } }, removedMembers: s.recipients.members.length - members.length };
  }
  return { ok: true, value: s, removedMembers: 0 };
}

/** 개별 지정 수신자 미리보기: 사용 안 함이거나 없는 수신자는 세지 않는다. */
export function countRoles(members: Array<{ recipientId: string; role: 'to' | 'cc' }>, recipients: Recipient[]): { to: number; cc: number } {
  const c = { to: 0, cc: 0 };
  for (const m of members) {
    const r = recipients.find((x) => x.id === m.recipientId);
    if (r?.enabled) c[m.role]++;
  }
  return c;
}

/** 켜기 전에 웹메일 접근 권한을 요청한다. 거부되면 false(켜지 않는다). 첫 await로 호출해야 한다. */
export async function requestToEnable(
  origin: string,
  request: (p: { origins: string[] }) => Promise<boolean>,
): Promise<boolean> {
  return await request({ origins: [origin] }).catch(() => false);
}
