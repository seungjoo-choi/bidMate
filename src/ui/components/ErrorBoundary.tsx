import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; /** 바뀌면 오류 상태를 비운다(예: 화면 주소). */ resetKey?: string }
interface State { error: Error | null }

/** 렌더 중 오류가 나도 앱 전체가 사라지지 않게 그 영역에 오류 내용을 보여준다. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo) { console.error('[bidMate] 화면 오류', error, info.componentStack); }

  override componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="space-y-3 rounded-card border border-danger/40 bg-danger-wash p-6 text-sm">
        <p className="text-base font-semibold text-danger">화면을 그리다 오류가 났습니다</p>
        <pre className="max-h-80 overflow-auto rounded-ctl bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-ink">{`${error.name}: ${error.message}\n${error.stack ?? ''}`}</pre>
        <button type="button" className="font-semibold text-accent hover:underline" onClick={() => this.setState({ error: null })}>다시 시도</button>
      </div>
    );
  }
}
