import { StorageFolderCard } from './StorageFolderCard';
import { MailServiceCard } from './MailServiceCard';
import { G2bCard } from './G2bCard';
import { AutoComposeCard } from './AutoComposeCard';

export function SettingsPage() {
  return (
    <>
      <h1 className="title-mark text-2xl font-bold tracking-tight">설정</h1>
      <StorageFolderCard />
      <MailServiceCard />
      <AutoComposeCard />
      <G2bCard />
    </>
  );
}
