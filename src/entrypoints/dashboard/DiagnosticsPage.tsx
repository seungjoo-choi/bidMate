import { InlineAlert } from '../../ui/components';
import { CollectTestSection } from './CollectTestSection';
import { EvalProbeSection } from './EvalProbeSection';
import { PageTitle } from './menu';

export function DiagnosticsPage() {
  return (
    <>
      <PageTitle page="diagnostics" />
      <InlineAlert tone="info">
        DOM 진단(스냅샷/녹화)은 웹메일 탭에서 확장 아이콘 팝업의 [사이드 패널 열기]로 사이드 패널을 연 뒤, 하단 [개발자 진단]을 펼쳐 실행합니다.
        저장 폴더 점검은 설정의 [저장 테스트]를 사용하세요.
      </InlineAlert>
      {/* 카드가 짧아 넓은 화면에서는 나란히 둔다. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <CollectTestSection />
        <EvalProbeSection />
      </div>
    </>
  );
}
