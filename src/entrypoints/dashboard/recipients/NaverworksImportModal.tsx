import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildImportPlan, defaultSelection, diffContacts, domainIdFrom, NW_CONTACT_ORIGIN, parseNwUsers, planCount, type ContactDiff, type DiffSelection } from '../../../core/recipients/naverworks-contacts';
import type { RecipientImportSummary } from '../../../core/types/config-file';
import type { Recipient } from '../../../core/types/recipient';
import { send } from '../../../messaging/bus';
import { Button, FormActions, inputClass, InlineAlert } from '../../../ui/components';
import { errorText, Modal } from './shared';

type Phase = 'fetching' | 'domain-input' | 'preview' | 'applying' | 'error';
interface Err { code: string; message: string }

interface Props {
  recipients: Recipient[];
  /** 설정에 저장된 domainId */
  domainId?: string;
  /** 권한 요청이 거부되어 열린 경우 */
  initialErrorCode?: string;
  onClose: () => void;
  onDomainIdDetected: (domainId: string) => void;
  onApplied: (summary: RecipientImportSummary) => void;
}

const toErr = (e: unknown): Err => ({ code: (e as { code?: string })?.code ?? 'INTERNAL', message: e instanceof Error ? e.message : String(e) });

/** 네이버웍스 사내 연락처를 받아 기존 수신자와 비교하고, 체크한 것만 반영하는 팝업. */
export function NaverworksImportModal({ recipients, domainId, initialErrorCode, onClose, onDomainIdDetected, onApplied }: Props) {
  const [phase, setPhase] = useState<Phase>(initialErrorCode ? 'error' : 'fetching');
  const [error, setError] = useState<Err | null>(initialErrorCode ? { code: initialErrorCode, message: '' } : null);
  const [diff, setDiff] = useState<ContactDiff | null>(null);
  const [sel, setSel] = useState<DiffSelection | null>(null);
  const [total, setTotal] = useState(0);
  const [skippedNoEmail, setSkippedNoEmail] = useState(0);
  const [domainText, setDomainText] = useState('');
  const token = useRef(0);
  const domainRef = useRef(domainId);

  const load = async (id: string | undefined) => {
    const mine = ++token.current;
    setPhase('fetching');
    setError(null);
    try {
      if (error?.code === 'NEEDS_SITE_PERMISSION') {
        // 재시도 클릭 안에서 첫 await로 권한을 다시 요청한다.
        const ok = await chrome.permissions.request({ origins: [NW_CONTACT_ORIGIN] }).catch(() => false);
        if (mine !== token.current) return;
        if (!ok) { setError({ code: 'NEEDS_SITE_PERMISSION', message: '' }); setPhase('error'); return; }
      }
      const res = await send('contacts/naverworks-fetch', id ? { domainId: id } : {}, { timeoutMs: 90_000 });
      if (mine !== token.current) return;
      if (res.domainId !== domainRef.current) { domainRef.current = res.domainId; onDomainIdDetected(res.domainId); }
      const parsed = parseNwUsers(res.users);
      const d = diffContacts(parsed.contacts, recipients);
      setDiff(d);
      setSel(defaultSelection(d));
      setTotal(parsed.contacts.length);
      setSkippedNoEmail(parsed.skippedNoEmail);
      setPhase('preview');
    } catch (e) {
      if (mine !== token.current) return;
      const err = toErr(e);
      setError(err);
      setPhase(err.code === 'NW_NO_DOMAIN_ID' ? 'domain-input' : 'error');
    }
  };

  useEffect(() => {
    if (!initialErrorCode) void load(domainId);
    return () => { token.current++; };
    // 열릴 때 한 번만 불러온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = useMemo(() => (diff && sel ? buildImportPlan(diff, sel) : null), [diff, sel]);
  const count = plan ? planCount(plan) : 0;

  const apply = async () => {
    if (!plan || count === 0) return;
    setPhase('applying');
    try {
      const res = await send('recipients/import', { plan });
      onApplied(res.summary);
      onClose();
    } catch (e) {
      setError(toErr(e));
      setPhase('error');
    }
  };

  const toggle = (key: keyof DiffSelection, id: string) => setSel((s) => {
    if (!s) return s;
    const next = new Set(s[key]);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...s, [key]: next };
  });
  const setAll = (key: keyof DiffSelection, ids: string[], on: boolean) => setSel((s) => (s ? { ...s, [key]: on ? new Set(ids) : new Set<string>() } : s));

  const domainFromInput = domainIdFrom(domainText);
  const upToDate = diff && diff.added.length === 0 && diff.changed.length === 0 && diff.missing.length === 0;

  let body: ReactNode;
  let footer: ReactNode = null;
  if (phase === 'fetching' || phase === 'applying') {
    body = (
      <p className="flex items-center gap-2 py-6 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        {phase === 'fetching' ? '네이버웍스에서 연락처를 불러오는 중입니다.' : '반영하는 중입니다.'}
      </p>
    );
  } else if (phase === 'domain-input') {
    body = (
      <div className="space-y-3">
        <InlineAlert tone="warn">사내 연락처 번호(domainId)를 찾지 못했습니다.</InlineAlert>
        <label className="block space-y-1.5 text-sm font-medium text-ink">
          사내 연락처 주소
          <input className={inputClass} value={domainText} onChange={(e) => setDomainText(e.target.value)} placeholder="https://contact.worksmobile.com/p/web/domain/123456" />
          <span className="block text-xs font-normal text-muted">사내 연락처 화면 주소(예: https://contact.worksmobile.com/p/web/domain/숫자)를 붙여 넣어 주세요</span>
        </label>
      </div>
    );
    footer = (
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button disabled={!domainFromInput} onClick={() => domainFromInput && void load(domainFromInput)}>다시 시도</Button>
      </div>
    );
  } else if (phase === 'error') {
    body = <InlineAlert tone="error">{error ? (error.code === 'TIMEOUT' ? TIMEOUT_TEXT : error.message && !MESSAGE_KNOWN(error.code) ? `${error.code}: ${error.message}` : errorText(error)) : ''}</InlineAlert>;
    footer = (
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>닫기</Button>
        <Button onClick={() => void load(domainRef.current)}>다시 시도</Button>
      </div>
    );
  } else if (diff && sel) {
    const notes = [
      diff.unchanged > 0 && `변경 없음 ${diff.unchanged}명`,
      diff.missingAlreadyDisabled > 0 && `이미 꺼짐 ${diff.missingAlreadyDisabled}명`,
      skippedNoEmail > 0 && `이메일 없음 ${skippedNoEmail}명`,
    ].filter(Boolean) as string[];
    const noteText = notes.length ? `${notes.join(' · ')} 제외` : '';
    if (upToDate) {
      body = <InlineAlert tone="ok">이미 최신 상태입니다. 네이버웍스 {total}명이 모두 등록되어 있습니다.</InlineAlert>;
      footer = (
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted">{noteText}</span>
          <Button onClick={onClose}>닫기</Button>
        </div>
      );
    } else {
      const addIds = diff.added.map((c) => c.email);
      const chgIds = diff.changed.map((c) => c.recipient.id);
      const misIds = diff.missing.map((r) => r.id);
      body = (
        <div className="space-y-5">
          {diff.added.length > 0 && (
            <Section title="새 사람" hint="주소록에 새로 등록합니다. 그룹에는 넣지 않습니다." ids={addIds} picked={sel.added} onAll={(on) => setAll('added', addIds, on)}>
              {diff.added.map((c) => (
                <Row key={c.email} checked={sel.added.has(c.email)} onChange={() => toggle('added', c.email)}>
                  <Who name={c.name} dept={c.dept} email={c.email} flag={c.flagged ? c.flagReason : undefined} />
                </Row>
              ))}
            </Section>
          )}
          {diff.changed.length > 0 && (
            <Section title="정보 바뀜" hint="이름이나 부서가 달라진 사람입니다." ids={chgIds} picked={sel.changed} onAll={(on) => setAll('changed', chgIds, on)}>
              {diff.changed.map(({ recipient: r, contact: c, fields }) => (
                <Row key={r.id} checked={sel.changed.has(r.id)} onChange={() => toggle('changed', r.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {fields.includes('name') ? <Change before={r.name} after={c.name} bold /> : <span className="text-[0.9375rem] font-semibold text-ink">{c.name}</span>}
                      {c.flagged && <FlagBadge reason={c.flagReason} />}
                    </div>
                    {fields.includes('dept') ? <div className="text-xs"><Change before={r.dept ?? '(없음)'} after={c.dept ?? '(없음)'} /></div> : c.dept && <div className="text-xs text-muted">{c.dept}</div>}
                    <div className="font-mono text-xs text-muted">{c.email}</div>
                  </div>
                </Row>
              ))}
            </Section>
          )}
          {diff.missing.length > 0 && (
            <Section title="목록에 없음" hint="체크하면 삭제하지 않고 메일 발송만 끕니다." ids={misIds} picked={sel.missing} onAll={(on) => setAll('missing', misIds, on)}>
              {diff.missing.map((r) => (
                <Row key={r.id} checked={sel.missing.has(r.id)} onChange={() => toggle('missing', r.id)}>
                  <Who name={r.name} dept={r.dept} email={r.email} />
                </Row>
              ))}
            </Section>
          )}
        </div>
      );
      footer = (
        <FormActions status={<span className="text-xs text-muted">{noteText}</span>}>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button disabled={count === 0} onClick={() => void apply()}>선택 반영 ({count}건)</Button>
        </FormActions>
      );
    }
  }

  return (
    <Modal open title="네이버웍스에서 불러오기" size="xl" onClose={phase === 'applying' ? () => undefined : onClose}>
      {body}
      {footer && <div className="mt-5 border-t border-line pt-4">{footer}</div>}
    </Modal>
  );
}

const KNOWN = new Set(['NEEDS_SITE_PERMISSION', 'NW_NOT_LOGGED_IN', 'NW_API_ERROR', 'NW_BAD_RESPONSE', 'NW_INJECT_FAILED', 'NW_TAB_TIMEOUT', 'TIMEOUT']);
const MESSAGE_KNOWN = (code: string) => KNOWN.has(code);
/** bus 시간 초과 문구는 이 모달에서만 네이버웍스 안내로 바꾼다(공용 MESSAGES에 두면 다른 수신자 작업에도 나온다). */
const TIMEOUT_TEXT = '응답이 늦어 중단했습니다. 네이버웍스 탭을 닫고 다시 시도해 주세요.';

function Section({ title, hint, ids, picked, onAll, children }: { title: string; hint: string; ids: string[]; picked: Set<string>; onAll: (on: boolean) => void; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title} <span className="text-muted">{picked.size}/{ids.length}</span></h3>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => onAll(true)}>모두 선택</Button>
          <Button variant="ghost" onClick={() => onAll(false)}>모두 해제</Button>
        </div>
      </div>
      <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-ctl border border-line">{children}</div>
    </section>
  );
}

function Row({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-sunken">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

function FlagBadge({ reason }: { reason?: string }) {
  return <span className="rounded-ctl bg-warn-wash px-1.5 py-0.5 text-xs font-medium text-warn">{reason ?? '확인 필요'}</span>;
}

function Who({ name, dept, email, flag }: { name: string; dept?: string; email: string; flag?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.9375rem] font-semibold text-ink">{name}</span>
        {flag && <FlagBadge reason={flag} />}
      </div>
      {dept && <div className="text-xs text-muted">{dept}</div>}
      <div className="font-mono text-xs text-muted">{email}</div>
    </div>
  );
}

function Change({ before, after, bold }: { before: string; after: string; bold?: boolean }) {
  return (
    <span className={bold ? 'text-[0.9375rem] font-semibold text-ink' : 'text-ink'}>
      <span className="text-faint line-through">{before}</span> → {after}
    </span>
  );
}
