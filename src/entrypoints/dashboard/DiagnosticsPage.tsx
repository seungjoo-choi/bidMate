import { InlineAlert } from '../../ui/components';
import { CollectTestSection } from './CollectTestSection';

export function DiagnosticsPage() {
  return (
    <>
      <h1 className="title-mark text-2xl font-bold tracking-tight">진단</h1>
      <InlineAlert tone="info">
        DOM 진단(스냅샷/녹화)은 웹메일 탭에서 확장 아이콘 팝업의 [사이드 패널 열기]로 사이드 패널을 연 뒤, 하단 [개발자 진단]을 펼쳐 실행합니다.
        저장 폴더 점검은 설정의 [저장 테스트]를 사용하세요.
      </InlineAlert>
      <CollectTestSection />
    </>
  );
}
