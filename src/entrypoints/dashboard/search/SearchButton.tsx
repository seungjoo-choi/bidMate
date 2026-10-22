import { Search } from 'lucide-react';
import { Button } from '../../../ui/components';
import { useNoticeSearch } from './NoticeSearchProvider';

const TIP = '이 공고에서 통합검색 (/ 또는 Ctrl+Shift+F)';

/**
 * 공고 통합검색 진입 버튼. icon: 상세 헤더용 아이콘 버튼, text: 텍스트 버튼,
 * row: 목록 행용 작은 아이콘(행에 group 클래스가 있으면 hover·포커스 때만 보이고 행 높이를 늘리지 않는다).
 */
export function SearchButton({ noticeId, title, variant = 'icon' }: { noticeId: string; title?: string; variant?: 'icon' | 'text' | 'row' }) {
  const { open } = useNoticeSearch();
  if (variant === 'row') {
    return (
      <button
        type="button" aria-label="이 공고에서 통합검색" title="이 공고에서 통합검색"
        className="inline-grid size-6 shrink-0 place-items-center rounded-ctl text-muted opacity-0 transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none [&_svg]:size-3.5"
        onClick={(e) => { e.stopPropagation(); open(noticeId, { title }); }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Search aria-hidden />
      </button>
    );
  }
  if (variant === 'text') {
    return <Button variant="ghost" icon={<Search />} title={TIP} onClick={() => open(noticeId, { title })}>이 공고에서 검색</Button>;
  }
  return <Button variant="ghost" size="icon" aria-label="이 공고에서 통합검색" title={TIP} icon={<Search />} onClick={() => open(noticeId, { title })} />;
}
