import { VARIABLES } from '../../../core/templates/variables';

const GROUPS = ['기본', '일정', '평가', '기타'] as const;

export interface VariablePaletteProps {
  /** 삽입할 입력이 있을 때만 true. */
  enabled: boolean;
  onInsert: (name: string) => void;
}

/** 변수 버튼 모음. 버튼을 눌러도 입력창 포커스가 빠지지 않도록 mousedown을 막는다. */
export function VariablePalette({ enabled, onInsert }: VariablePaletteProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{enabled ? '버튼을 누르면 마지막으로 선택한 입력칸의 커서 위치에 변수가 들어갑니다.' : '변수를 넣을 입력칸(제목, 인사말, 맺음말, 섹션 제목, 항목 라벨)을 먼저 선택하세요.'}</p>
      {GROUPS.map((g) => (
        <div key={g} className="flex flex-wrap items-center gap-1.5">
          <span className="w-10 shrink-0 text-xs font-semibold text-muted">{g}</span>
          {VARIABLES.filter((d) => d.group === g).map((d) => (
            <button
              key={d.name}
              type="button"
              disabled={!enabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(d.name)}
              className="rounded-ctl border border-line-strong bg-surface px-2 py-1 text-xs text-ink transition-colors hover:bg-sunken disabled:pointer-events-none disabled:opacity-40"
            >
              {d.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
