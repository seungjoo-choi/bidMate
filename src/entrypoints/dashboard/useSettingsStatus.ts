import { useCallback, useEffect, useState } from 'react';
import type { AiProvider } from '../../core/types/ai';
import { send } from '../../messaging/bus';
import type { FsStatus, SettingsSection } from '../../messaging/protocol';
import type { BadgeStatus } from '../../ui/components/StatusBadge';
import { useSettings } from '../../ui/hooks/useSettings';
import { originsToRequest } from './mail-service-logic';

export type SectionHealth = { tone: BadgeStatus; text: string };

type Secrets = { g2bServiceKey?: string; ai?: Partial<Record<AiProvider, string>> };

/** 설정 하위 메뉴에 붙일 항목별 상태. 카드가 저장하면 storage·권한 변경을 받아 다시 계산한다. */
export function useSettingsStatus(): Partial<Record<SettingsSection, SectionHealth>> {
  const { settings, stored } = useSettings();
  const [fs, setFs] = useState<FsStatus | null>(null);
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [mailOk, setMailOk] = useState<boolean | null>(null);
  const [perfCount, setPerfCount] = useState<number | null>(null);

  const loadFs = useCallback(() => {
    void send('fs/status', undefined, { timeoutMs: 30_000 }).then(setFs, () => setFs(null));
  }, []);

  useEffect(() => {
    const loadSecrets = () => void chrome.storage.local.get('secrets').then(({ secrets: s }) => setSecrets((s as Secrets | undefined) ?? {}));
    loadFs();
    loadSecrets();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.secrets) loadSecrets();
    };
    chrome.storage.onChanged.addListener(onChanged);
    window.addEventListener('focus', loadFs);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      window.removeEventListener('focus', loadFs);
    };
  }, [loadFs]);

  useEffect(() => {
    void send('performances/list', undefined).then((r) => setPerfCount(r.items.length), () => {});
  }, []);

  // 폴더 선택·재승인은 storage 이벤트가 없어서, 허용 상태가 될 때까지만 주기적으로 확인한다
  const fsOk = fs?.hasRoot && fs.permission === 'granted';
  useEffect(() => {
    if (fsOk) return;
    const t = setInterval(loadFs, 4000);
    return () => clearInterval(t);
  }, [fsOk, loadFs]);

  useEffect(() => {
    if (!settings) return;
    const origins = originsToRequest(settings);
    let alive = true;
    const check = () => void Promise.all(origins.map((o) => chrome.permissions.contains({ origins: [o] }).catch(() => false)))
      .then((rs) => { if (alive) setMailOk(rs.every(Boolean)); });
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      alive = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [settings]);

  const out: Partial<Record<SettingsSection, SectionHealth>> = {};
  if (fs) {
    out.storage = !fs.hasRoot ? { tone: 'idle', text: '필요' }
      : fs.permission === 'granted' ? { tone: 'ok', text: '완료' }
      : fs.permission === 'prompt' ? { tone: 'warn', text: '재승인' }
      : { tone: 'error', text: '거부됨' };
  }
  if (settings) {
    out['mail-service'] = !stored ? { tone: 'idle', text: '필요' }
      : mailOk === false ? { tone: 'warn', text: '권한 필요' }
      : { tone: 'ok', text: '완료' };
    out['auto-compose'] = settings.autoCompose.enabled ? { tone: 'ok', text: '사용 중' } : { tone: 'idle', text: '꺼짐' };
    out.company = settings.company.bizNo ? { tone: 'ok', text: '완료' } : { tone: 'idle', text: '선택' };
    out.notify = settings.notify.rank || settings.notify.final || settings.notify.deadline ? { tone: 'ok', text: '사용 중' } : { tone: 'idle', text: '꺼짐' };
  }
  if (perfCount !== null) out.performances = perfCount > 0 ? { tone: 'ok', text: `${perfCount}건` } : { tone: 'idle', text: '선택' };
  if (secrets) {
    out.g2b = secrets.g2bServiceKey ? { tone: 'ok', text: '완료' } : { tone: 'idle', text: '필요' };
    if (settings) {
      out.ai = settings.ai.mode === 'manual' ? { tone: 'ok', text: '프롬프트' }
        : secrets.ai?.[settings.ai.provider] ? { tone: 'ok', text: '완료' }
        : { tone: 'idle', text: '선택' };
    }
  }
  return out;
}
