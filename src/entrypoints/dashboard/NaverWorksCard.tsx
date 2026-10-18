import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_WEBMAIL_HOST } from '../../core/model/default-settings';
import { Button, Card, Field, InlineAlert, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

function normalizeHost(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
}

export function NaverWorksCard() {
  const { settings, stored, save } = useSettings();
  const [host, setHost] = useState(DEFAULT_WEBMAIL_HOST);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedHost = settings?.sites.naverworks.host;

  useEffect(() => {
    if (savedHost) setHost(savedHost);
  }, [savedHost]);

  useEffect(() => {
    if (!savedHost) return;
    chrome.permissions.contains({ origins: [`https://${savedHost}/*`] }).then(setGranted, () => setGranted(false));
  }, [savedHost]);

  const submit = async () => {
    if (!settings) return;
    setError(null);
    const h = normalizeHost(host);
    if (!HOST_RE.test(h)) {
      setError('올바른 호스트를 입력하세요. 예: mail.worksmobile.com');
      return;
    }
    setBusy(true);
    try {
      // 사용자 제스처 안에서 첫 await로 호출해야 한다.
      const ok = await chrome.permissions.request({ origins: [`https://${h}/*`] });
      await save({
        ...settings,
        sites: { ...settings.sites, naverworks: { ...settings.sites.naverworks, host: h } },
      });
      setHost(h);
      setGranted(ok);
      if (!ok) setError('호스트 접근 권한이 허용되지 않았습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="네이버웍스" description="메일 작성 자동 입력과 트래커봇 메일의 [공고 수집] 버튼에 웹메일 호스트 접근 권한이 필요합니다.">
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
      <div className="flex items-center gap-3">
        <Button icon={<ShieldCheck />} loading={busy} disabled={!settings} onClick={submit}>
          저장 및 권한 허용
        </Button>
        {!stored ? (
          <StatusBadge status="idle">미설정</StatusBadge>
        ) : granted === null ? (
          <StatusBadge status="idle">확인 중</StatusBadge>
        ) : granted ? (
          <StatusBadge status="ok">권한 허용됨</StatusBadge>
        ) : (
          <StatusBadge status="warn">권한 없음</StatusBadge>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
