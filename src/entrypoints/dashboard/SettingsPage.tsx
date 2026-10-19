import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsSection } from '../../messaging/protocol';
import { StorageFolderCard } from './StorageFolderCard';
import { MailServiceCard } from './MailServiceCard';
import { G2bCard } from './G2bCard';
import { AutoComposeCard } from './AutoComposeCard';

const HIGHLIGHT_MS = 2400;

export function SettingsPage({ section, nonce }: { section?: SettingsSection; nonce?: string }) {
  const [lit, setLit] = useState<SettingsSection | undefined>(section);
  // 오류 화면에서 넘어오면 고칠 카드로 스크롤하고 잠깐 강조한다. 카드가 비동기로 채워져 높이가 바뀌므로 한 박자 늦게 스크롤한다
  useEffect(() => {
    setLit(section);
    if (!section) return;
    const scroll = setTimeout(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    const off = setTimeout(() => setLit(undefined), HIGHLIGHT_MS);
    return () => { clearTimeout(scroll); clearTimeout(off); };
  }, [section, nonce]);

  const slot = (id: SettingsSection, card: ReactNode) => (
    <div
      id={`settings-${id}`}
      className={`scroll-mt-6 rounded-card transition-shadow duration-500 motion-reduce:transition-none ${lit === id ? 'ring-2 ring-primary ring-offset-4 ring-offset-canvas' : ''}`}
    >
      {card}
    </div>
  );

  return (
    <>
      <h1 className="title-mark text-2xl font-bold tracking-tight">설정</h1>
      {slot('storage', <StorageFolderCard />)}
      {slot('mail-service', <MailServiceCard />)}
      {slot('auto-compose', <AutoComposeCard />)}
      {slot('g2b', <G2bCard />)}
    </>
  );
}
