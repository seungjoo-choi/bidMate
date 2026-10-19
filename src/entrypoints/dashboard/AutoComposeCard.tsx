import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { kindOf } from '../../core/model/ids';
import { composeHost,originOf } from '../../core/model/mail-provider';
import type { AfterCollect, AutoComposeSettings, ReviewGate } from '../../core/types/settings';
import { Button, Card, Field, InlineAlert, Select, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useRecipients, useTemplates } from '../../ui/hooks/useConfig';
import { useSettings } from '../../ui/hooks/useSettings';
import { countRoles, findBroken, requestToEnable, sanitizeForSave } from './auto-compose-logic';

const AFTER: Array<{ id: AfterCollect; label: string }> = [
  { id: 'ask', label: '수집이 끝나면 진행 팝업에서 고르기(대시보드 편집 / 바로 작성)' },
  { id: 'dashboard', label: '대시보드에서 내용 확인 후 작성' },
  { id: 'compose', label: '바로 웹메일 작성 화면 열기' },
];
const GATES: Array<{ id: ReviewGate; label: string }> = [
  { id: 'conflicts', label: '충돌/저신뢰 항목이 있을 때(권장)' },
  { id: 'any_review', label: '확인 필요 항목이 하나라도 있을 때' },
  { id: 'errors_only', label: '오류일 때만' },
];

export function AutoComposeCard() {
  const { settings, save } = useSettings();
  const rec = useRecipients();
  const tpls = useTemplates();
  const [draft, setDraft] = useState<AutoComposeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saved = settings?.autoCompose;
  useEffect(() => { if (saved) setDraft(saved); }, [saved]);

  const groups = rec.data?.groups ?? [];
  const recipients = rec.data?.recipients ?? [];
  const templates = tpls.data?.templates ?? [];
  const loaded = rec.data !== null && tpls.data !== null;

  if (!settings || !draft) return <Card title="자동 메일 작성" />;

  const broken = loaded ? findBroken(draft, groups, recipients, templates) : { groupMissing: false, templateMissing: false, prespecTemplateMissing: false, memberIds: [] as string[] };
  const members = draft.recipients.mode === 'custom' ? draft.recipients.members : [];
  const roles = countRoles(members, recipients);
  const update = (patch: Partial<AutoComposeSettings>) => { setDraft({ ...draft, ...patch }); setNote(null); };

  const toggle = async (on: boolean) => {
    setError(null);
    if (on) {
      // 사용자 제스처 안에서 첫 await로 호출해야 한다.
      const origin = originOf(composeHost(settings)); // permissions.request 전에 await를 두지 않는다(사용자 제스처 유지)
      const ok = await requestToEnable(origin, (p) => chrome.permissions.request(p));
      if (!ok) { setError('웹메일 접근 권한이 허용되지 않아 켜지 않았습니다.'); return; }
    }
    update({ enabled: on });
  };

  const submit = async () => {
    setError(null);
    setNote(null);
    const r = sanitizeForSave(draft, groups, recipients, templates);
    if (!r.ok) { setError(r.message); return; }
    setBusy(true);
    try {
      await save({ ...settings, autoCompose: r.value });
      setDraft(r.value);
      if (r.removedMembers > 0) setNote(`삭제된 수신자 ${r.removedMembers}명을 제외하고 저장했습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mode = draft.recipients.mode;
  const setMember = (id: string, patch: { on?: boolean; role?: 'to' | 'cc' }) => {
    const cur = members.filter((m) => m.recipientId !== id || patch.on !== false);
    const old = members.find((m) => m.recipientId === id);
    const next = patch.on === false ? cur : old
      ? cur.map((m) => (m.recipientId === id ? { ...m, role: patch.role ?? m.role } : m))
      : [...cur, { recipientId: id, role: patch.role ?? recipients.find((r) => r.id === id)?.defaultRole ?? 'to' }];
    update({ recipients: { mode: 'custom', members: next } });
  };

  return (
    <Card title="자동 메일 작성" description="수집이 끝나면 고른 동작(팝업에서 고르기 / 대시보드 편집 / 바로 작성)을 합니다. 끄면 자동 작성과 검수 화면 이동이 모두 꺼집니다.">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" className="accent-current" checked={draft.enabled} onChange={(e) => void toggle(e.target.checked)} />
        수집 완료 후 메일 작성으로 이어가기
      </label>

      <Field label="완료 후 동작" help="'고르기'면 웹메일 화면 오른쪽 아래 진행 팝업에 [대시보드 편집] [바로 작성] 버튼이 나옵니다. 나라장터 패널이나 대시보드에서 수집한 건은 대시보드 메일 준비 화면에서 이어 갑니다.">
        <div className="space-y-1.5">
          {AFTER.map((a) => (
            <label key={a.id} className={`flex items-center gap-2 text-sm ${draft.enabled ? '' : 'opacity-50'}`}>
              <input type="radio" name="ac-after" className="accent-current" disabled={!draft.enabled} checked={draft.afterCollect === a.id} onChange={() => update({ afterCollect: a.id })} />
              {a.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="검수 기준" help="기준에 걸리면 자동 작성 대신 검수 화면을 엽니다.">
        <div className="space-y-1.5">
          {GATES.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="ac-gate" className="accent-current" checked={draft.reviewGate === g.id} onChange={() => update({ reviewGate: g.id })} />
              {g.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="수신자">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="ac-rcpt" className="accent-current" checked={mode === 'default'} onChange={() => update({ recipients: { mode: 'default' } })} />
            기본 수신 그룹
          </label>
          {mode === 'default' && !groups.some((g) => g.isDefault) && (
            <InlineAlert tone="warn">기본 수신 그룹이 지정되지 않았습니다. 수신자 메뉴에서 기본 그룹을 지정하거나 아래에서 그룹이나 수신자를 직접 고르세요.</InlineAlert>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" name="ac-rcpt" className="accent-current" checked={mode === 'group'}
              onChange={() => update({ recipients: { mode: 'group', groupId: groups.find((g) => g.isDefault)?.id ?? groups[0]?.id ?? '' } })} />
            그룹 선택
          </label>
          {draft.recipients.mode === 'group' && (
            <div className="flex items-center gap-2 pl-6">
              <Select
                aria-label="수신 그룹"
                value={draft.recipients.groupId}
                onChange={(v) => update({ recipients: { mode: 'group', groupId: v } })}
                options={[
                  ...(broken.groupMissing ? [{ value: draft.recipients.groupId, label: '(삭제됨)' }] : []),
                  ...groups.map((g) => ({ value: g.id, label: g.name, hint: g.isDefault ? '기본' : undefined })),
                ]}
              />
              {broken.groupMissing && <StatusBadge status="error">삭제됨</StatusBadge>}
            </div>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" name="ac-rcpt" className="accent-current" checked={mode === 'custom'} onChange={() => update({ recipients: { mode: 'custom', members } })} />
            개별 지정
          </label>
          {mode === 'custom' && (
            <div className="space-y-1.5 pl-6">
              {recipients.map((r) => {
                const m = members.find((x) => x.recipientId === r.id);
                return (
                  <div key={r.id} className={`flex items-center gap-2 ${r.enabled ? '' : 'opacity-50'}`}>
                    <input type="checkbox" aria-label={r.name || r.email} className="accent-current" checked={!!m} onChange={(e) => setMember(r.id, { on: e.target.checked })} />
                    <span className="min-w-0 flex-1 truncate">{r.name || r.email}{!r.enabled && ' (사용 안 함)'}</span>
                    <Select
                      aria-label={`${r.name || r.email} 역할`}
                      className="!w-24"
                      disabled={!m}
                      value={m?.role ?? r.defaultRole}
                      onChange={(v) => setMember(r.id, { role: v === 'cc' ? 'cc' : 'to' })}
                      options={[{ value: 'to', label: 'TO' }, { value: 'cc', label: 'CC' }]}
                    />
                  </div>
                );
              })}
              {broken.memberIds.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <StatusBadge status="error">삭제됨</StatusBadge>삭제된 수신자 {broken.memberIds.length}명은 저장 시 제외됩니다
                </div>
              )}
              <p className="text-xs text-muted">TO {roles.to}명, CC {roles.cc}명</p>
            </div>
          )}
        </div>
      </Field>

      <Field label="템플릿" htmlFor="ac-tpl" help="비우면 기본 템플릿을 사용합니다.">
        <div className="flex items-center gap-2">
          <Select
            id="ac-tpl"
            value={draft.templateId ?? ''}
            onChange={(v) => update({ templateId: v || undefined })}
            options={[
              { value: '', label: '(기본 템플릿)' },
              ...(broken.templateMissing && draft.templateId ? [{ value: draft.templateId, label: '(삭제됨)' }] : []),
              ...templates.filter((t) => kindOf(t) === 'bid').map((t) => ({ value: t.id, label: t.name, hint: t.isDefault ? '기본' : undefined })),
              ...templates.filter((t) => t.id === draft.templateId && kindOf(t) !== 'bid').map((t) => ({ value: t.id, label: t.name, group: '(다른 종류)' })),
            ]}
          />
          {broken.templateMissing && <StatusBadge status="error">삭제됨</StatusBadge>}
        </div>
      </Field>

      <Field label="사전규격 템플릿" htmlFor="ac-tpl-prespec" help="비우면 사전규격 기본 템플릿을 사용합니다.">
        <div className="flex items-center gap-2">
          <Select
            id="ac-tpl-prespec"
            value={draft.prespecTemplateId ?? ''}
            onChange={(v) => update({ prespecTemplateId: v || undefined })}
            options={[
              { value: '', label: '(기본 템플릿)' },
              ...(broken.prespecTemplateMissing && draft.prespecTemplateId ? [{ value: draft.prespecTemplateId, label: '(삭제됨)' }] : []),
              ...templates.filter((t) => kindOf(t) === 'prespec').map((t) => ({ value: t.id, label: t.name, hint: t.isDefault ? '기본' : undefined })),
              ...templates.filter((t) => t.id === draft.prespecTemplateId && kindOf(t) !== 'prespec').map((t) => ({ value: t.id, label: t.name, group: '(다른 종류)' })),
            ]}
          />
          {broken.prespecTemplateMissing && <StatusBadge status="error">삭제됨</StatusBadge>}
        </div>
      </Field>

      <div className="flex items-center gap-3">
        <Button icon={<Save />} loading={busy} disabled={!loaded} onClick={submit}>저장</Button>
        <StatusBadge status={saved?.enabled ? 'ok' : 'idle'}>{saved?.enabled ? '사용 중' : '사용 안 함'}</StatusBadge>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {note && <InlineAlert tone="info">{note}</InlineAlert>}
    </Card>
  );
}
