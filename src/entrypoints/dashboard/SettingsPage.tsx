import { StorageFolderCard } from './StorageFolderCard';
import { NaverWorksCard } from './NaverWorksCard';
import { G2bCard } from './G2bCard';
import { AutoComposeCard } from './AutoComposeCard';

export function SettingsPage() {
  return (
    <>
      <h1 className="title-mark text-2xl font-bold tracking-tight">설정</h1>
      <StorageFolderCard />
      <NaverWorksCard />
      <AutoComposeCard />
      <G2bCard />
    </>
  );
}
