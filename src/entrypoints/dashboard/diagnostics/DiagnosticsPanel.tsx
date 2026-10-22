import { useState } from 'react';
import { Card } from '../../../ui/components';
import { CollectTool } from './CollectTool';
import { EvalProbeTool } from './EvalProbeTool';
import { G2bFailuresTool } from './G2bFailuresTool';
import { ResultProbeTool } from './ResultProbeTool';

const TOOLS = [
  { id: 'collect', label: '공고 수집', Tool: CollectTool },
  { id: 'eval', label: '평가 점수 API', Tool: EvalProbeTool },
  { id: 'result', label: '낙찰 결과 API', Tool: ResultProbeTool },
  { id: 'failures', label: '실패 기록', Tool: G2bFailuresTool },
] as const;

const tabCls = (on: boolean) =>
  `rounded-ctl px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none ${on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`;

/** 설정 > 개발자 진단. 나라장터 연동이 제대로 도는지 공고번호 하나로 확인하는 도구 모음 */
export function DiagnosticsPanel() {
  const [tab, setTab] = useState<(typeof TOOLS)[number]['id']>('collect');
  return (
    <Card
      title="개발자 진단"
      description="나라장터 연동이 제대로 동작하는지 공고번호 하나로 확인합니다. 평소에는 쓸 일이 없습니다."
    >
      <div role="tablist" aria-label="진단 도구" className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-ctl border border-line bg-sunken p-0.5">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tabCls(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* 탭을 옮겨도 진행 중인 결과가 사라지지 않게 모두 그려 두고 숨긴다. */}
      {TOOLS.map(({ id, Tool }) => (
        <div key={id} role="tabpanel" hidden={tab !== id}>
          <Tool />
        </div>
      ))}
      <p className="border-t border-line pt-4 text-xs text-muted">
        웹메일 DOM 진단(스냅샷·녹화)은 웹메일 탭에서 사이드 패널을 연 뒤 하단 [개발자 진단]에서 실행합니다. 저장 폴더 점검은 [저장 폴더]의 [저장 테스트]를 쓰세요.
      </p>
    </Card>
  );
}
