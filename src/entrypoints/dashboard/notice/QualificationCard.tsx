import { ArrowRight, ListChecks, Quote } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { criteriaOf, judge } from '../../../core/qualification/judge';
import type { Extraction } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import type { PerformanceRecord } from '../../../core/types/performance';
import { send } from '../../../messaging/bus';
import { Card, StatusBadge } from '../../../ui/components';
import { qualificationView } from '../../../ui/notice-detail/qualification-view';

export function QualificationCard({ notice, extraction }: { notice: Notice; extraction: Extraction | null }) {
  const [items, setItems] = useState<PerformanceRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    send('performances/list', undefined).then(
      (r) => { if (alive) setItems(r.items); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, []);

  const result = useMemo(() => {
    if (!items) return null;
    const criteria = criteriaOf(notice, extraction);
    return { view: qualificationView(judge(criteria, items), criteria), conditionText: criteria.condition.text };
  }, [items, notice, extraction]);

  const title = '참가 자격(실적)';
  const description = '공고의 실적 인정기준과 우리 실적 목록을 비교한 참고 판정입니다. 최종 판단은 공고문과 실적증명서로 확인하세요.';

  if (failed) {
    return <Card title={title} description={description}><p className="text-sm text-muted">실적 목록을 읽지 못했습니다</p></Card>;
  }
  if (!result) return <Card title={title} description={description} />;

  const { view, conditionText } = result;
  return (
    <Card
      title={title}
      description={description}
      action={
        <a
          className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line-strong bg-surface px-3 text-sm font-semibold whitespace-nowrap text-ink shadow-btn transition-colors hover:bg-sunken motion-reduce:transition-none"
          href={view.settingsHref}
        >
          <ListChecks className="size-[15px] stroke-[1.75] text-muted" aria-hidden />
          실적 목록 관리
        </a>
      }
    >
      <div className="flex items-center gap-3">
        <StatusBadge status={view.badge.status}>{view.badge.text}</StatusBadge>
        <p className="text-sm text-ink">{view.headline}</p>
      </div>
      {view.lines.map((l, i) => (
        <div key={i} className="space-y-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
          {l.title && <p className="text-sm font-medium text-ink">{l.title}</p>}
          <ul className="space-y-1 text-sm text-muted">
            {l.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          {l.matched.length > 0 && (
            <table className="w-full table-fixed text-left text-sm">
              <thead className="text-muted">
                <tr><th className="py-1 font-medium">사업명</th><th className="py-1 font-medium">발주기관</th><th className="py-1 font-medium">비교 금액</th><th className="py-1 font-medium">완료일</th></tr>
              </thead>
              <tbody>
                {l.matched.map((m, k) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink">{m.title}</td>
                    <td className="py-1 pr-2">{m.client}</td>
                    <td className="py-1 pr-2 font-mono tabular-nums">{m.compareAmount}</td>
                    <td className="py-1 font-mono tabular-nums">{m.endAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {l.more > 0 && <p className="text-sm text-muted">외 {l.more}건</p>}
        </div>
      ))}
      {view.footnotes.length > 0 && (
        <div className="space-y-1 border-t border-line pt-4 text-sm text-muted">
          {view.footnotes.map((f) => <p key={f}>{f}</p>)}
        </div>
      )}
      {view.condition && conditionText && (
        <div className="space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Quote className="size-3.5 text-muted" aria-hidden />인정조건 원문
            </p>
            <a
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              href={`#/notices/${notice.id}/review`}
            >
              {view.condition.truncated ? '검토 탭에서 전체 보기' : '검토 탭에서 보기'}
              <ArrowRight className="size-3.5" aria-hidden />
            </a>
          </div>
          <blockquote className="rounded-md border-l-2 border-line-strong bg-sunken px-3 py-2 text-sm leading-6 text-muted">
            {view.condition.text}{view.condition.truncated && '…'}
          </blockquote>
        </div>
      )}
    </Card>
  );
}
