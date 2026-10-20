import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_WEBMAIL_HOST } from '../../core/model/default-settings';
import { composeProvider, inboxProvider, PROVIDER_LABEL } from '../../core/model/mail-provider';
import type { MailProvider, Settings } from '../../core/types/settings';
import { Button, Card, Field, FormActions, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';
import { originsToRequest } from './mail-service-logic';

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const PROVIDERS: MailProvider[] = ['naverworks', 'gmail'];

function normalizeHost(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
}

function ProviderRadio({ name, value, onChange }: { name: string; value: MailProvider; onChange: (p: MailProvider) => void }) {
  return (
    <div className="flex items-center gap-4">
      {PROVIDERS.map((p) => (
        <label key={p} className="flex items-center gap-1.5 text-sm">
          <input type="radio" name={name} checked={value === p} onChange={() => onChange(p)} />
          {PROVIDER_LABEL[p]}
        </label>
      ))}
    </div>
  );
}

export function MailServiceCard() {
  const { settings, stored, save } = useSettings();
  const [host, setHost] = useState(DEFAULT_WEBMAIL_HOST);
  const [composeP, setComposeP] = useState<MailProvider>('naverworks');
  const [inboxP, setInboxP] = useState<MailProvider>('naverworks');
  const [accountIndex, setAccountIndex] = useState('0');
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedHost = settings?.sites.naverworks.host;
  const savedCompose = settings ? composeProvider(settings) : undefined;
  const savedInbox = settings ? inboxProvider(settings) : undefined;
  const savedIndex = settings?.sites.gmail.accountIndex;

  useEffect(() => {
    if (savedHost) setHost(savedHost);
  }, [savedHost]);
  useEffect(() => {
    if (savedCompose) setComposeP(savedCompose);
  }, [savedCompose]);
  useEffect(() => {
    if (savedInbox) setInboxP(savedInbox);
  }, [savedInbox]);
  useEffect(() => {
    if (savedIndex !== undefined) setAccountIndex(String(savedIndex));
  }, [savedIndex]);

  // 권한 배지는 저장된 설정의 호스트 기준. 권한 변경에도 다시 계산한다.
  useEffect(() => {
    if (!settings) return;
    const origins = originsToRequest(settings);
    let alive = true;
    let seq = 0;
    const check = () => {
      const my = ++seq;
      void Promise.all(origins.map((o) => chrome.permissions.contains({ origins: [o] }).catch(() => false))).then((rs) => {
        if (alive && my === seq) setGranted(Object.fromEntries(origins.map((o, i) => [o, !!rs[i]])));
      });
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      alive = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [settings]);

  const usesNaver = composeP === 'naverworks' || inboxP === 'naverworks';
  const usesGmail = composeP === 'gmail' || inboxP === 'gmail';

  const submit = async () => {
    if (!settings) return;
    setError(null);
    const h = normalizeHost(host);
    if (usesNaver && !HOST_RE.test(h)) {
      setError('올바른 호스트를 입력하세요. 예: mail.worksmobile.com');
      return;
    }
    const idx = Number(accountIndex);
    if (usesGmail && (!Number.isInteger(idx) || idx < 0)) {
      setError('계정 번호는 0 이상의 정수여야 합니다.');
      return;
    }
    const next: Settings = {
      ...settings,
      mail: { ...settings.mail, provider: composeP },
      sites: {
        ...settings.sites,
        trackerbot: { ...settings.sites.trackerbot, provider: inboxP },
        naverworks: { ...settings.sites.naverworks, host: usesNaver ? h : settings.sites.naverworks.host },
        gmail: { ...settings.sites.gmail, accountIndex: usesGmail ? idx : settings.sites.gmail.accountIndex },
      },
    };
    setBusy(true);
    try {
      // 사용자 제스처 안에서 첫 await로 호출해야 한다.
      const ok = await chrome.permissions.request({ origins: originsToRequest(next) });
      await save(next);
      if (usesNaver) setHost(h);
      if (!ok) setError('호스트 접근 권한이 허용되지 않았습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="메일 서비스" description="메일 작성과 트래커봇 메일의 [공고 수집] 버튼에 쓸 서비스를 고르고 접근 권한을 허용합니다.">
      <Field label="메일 작성 서비스">
        <ProviderRadio name="mail-compose-provider" value={composeP} onChange={setComposeP} />
      </Field>
      <Field label="트래커봇 메일을 받는 서비스">
        <ProviderRadio name="mail-inbox-provider" value={inboxP} onChange={setInboxP} />
      </Field>
      {usesNaver && (
        <Field
          label="웹메일 호스트"
          htmlFor="nw-host"
          help="계정이 @xcs.co.kr이어도 웹메일 주소는 보통 mail.worksmobile.com입니다. 브라우저 주소창의 호스트를 입력하세요."
        >
          <input
            id="nw-host"
            className={inputClass}
            value={host}
            placeholder={DEFAULT_WEBMAIL_HOST}
            onChange={(e) => setHost(e.target.value)}
          />
        </Field>
      )}
      {usesGmail && (
        <>
          <Field label="계정 번호" htmlFor="gmail-account" help="Gmail 주소창의 mail.google.com/mail/u/N/ 에서 N. 계정이 하나면 0">
            <input
              id="gmail-account"
              type="number"
              min={0}
              className={inputClass}
              value={accountIndex}
              onChange={(e) => setAccountIndex(e.target.value)}
            />
          </Field>
          <InlineAlert tone="info">
            Gmail은 작성 창을 열며 받는 사람, 참조, 제목, 본문(서식 없음)을 채웁니다. 첨부 파일과 서식은 직접 넣어야 합니다.
          </InlineAlert>
        </>
      )}
      <FormActions
        status={
          <div className="flex flex-wrap items-center gap-2">
            {!stored ? (
              <StatusBadge status="idle">미설정</StatusBadge>
            ) : settings && Object.keys(granted).length === 0 ? (
              <StatusBadge status="idle">확인 중</StatusBadge>
            ) : (
              settings && originsToRequest(settings).map((o) => (
                <StatusBadge key={o} status={granted[o] ? 'ok' : 'warn'}>
                  {o.replace(/^https:\/\/|\/\*$/g, '')} {granted[o] ? '권한 허용됨' : '권한 없음'}
                </StatusBadge>
              ))
            )}
          </div>
        }
      >
        <Button icon={<ShieldCheck />} loading={busy} disabled={!settings} onClick={submit}>
          저장 및 권한 허용
        </Button>
      </FormActions>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
