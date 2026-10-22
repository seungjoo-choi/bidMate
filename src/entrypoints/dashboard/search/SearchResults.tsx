import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { SearchDoc, SearchGroup, SearchHit } from '../../../core/search/types';
import { fieldLinkOf, groupLabel, hitNeedles, snippetParts } from '../../../ui/search/search-view';

interface Props {
  groups: SearchGroup[];
  /** docId → 줄별 쪽 번호. 쪽 표시가 없는 문서는 없음 */
  pages: Map<string, Array<string | null>>;
  onOpenHit(hit: SearchHit, doc: SearchDoc): void;
  /** 항목값 링크로 이동할 때(패널을 닫는다) */
  onNavigate(): void;
  /** 그룹당 최대 표시 건수(상한 안내 문구용) */
  limit: number;
}

function Snippet({ hit, doc }: { hit: SearchHit; doc: SearchDoc }) {
  return (
    <span className="min-w-0 flex-1 wrap-anywhere">
      {snippetParts(hit.snippet, hitNeedles(hit, doc)).map((p, i) => (p.mark ? <mark key={i} className="rounded-sm bg-mark-strong px-0.5 text-ink">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** 그룹별 접이식 결과. 순서는 문서 순서 그대로, 0건 그룹은 맨 아래에 모은다. */
export function SearchResults({ groups, pages, onOpenHit, onNavigate, limit }: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hit = groups.filter((g) => g.total > 0);
  const none = groups.filter((g) => g.total === 0);
  return (
    <div className="space-y-4">
      {hit.map((g) => {
        const open = !closed.has(g.doc.id);
        return (
          <section key={g.doc.id} className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <button type="button" aria-expanded={open} className="flex w-full items-center gap-3 bg-sunken px-5 py-3 text-left text-sm" onClick={() => toggle(g.doc.id)}>
              {open ? <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
              <span className="shrink-0 text-muted">{g.doc.kindLabel}</span>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">{g.doc.label}</span>
              <span className="shrink-0 tabular-nums text-muted">{g.total}건</span>
            </button>
            {open && (
              <>
                {g.hits.map((h, i) => {
                  const link = fieldLinkOf(h, g.doc);
                  const page = pages.get(g.doc.id)?.[h.line];
                  const where = g.doc.kind === 'fields' ? null : `${page ? `${page}쪽 · ` : ''}${h.line + 1}줄`;
                  const body = (
                    <>
                      {where && <span className="w-20 shrink-0 text-xs leading-5 tabular-nums text-faint">{where}</span>}
                      <Snippet hit={h} doc={g.doc} />
                    </>
                  );
                  return g.doc.kind === 'fields' ? (
                    <div key={i} className="flex items-start gap-3 border-t border-line px-5 py-3 text-sm">
                      {body}
                      {link && <a href={link.hash} className="shrink-0 text-accent hover:underline" onClick={onNavigate}>{link.label}</a>}
                    </div>
                  ) : (
                    <button key={i} type="button" className="flex w-full items-start gap-3 border-t border-line px-5 py-3 text-left text-sm hover:bg-sunken" onClick={() => onOpenHit(h, g.doc)}>
                      {body}
                    </button>
                  );
                })}
                {g.truncated && <div className="border-t border-line px-5 py-3 text-xs text-muted">처음 {limit}건만 표시합니다(전체 {g.total}건). 질의를 더 구체적으로 좁혀 보세요.</div>}
              </>
            )}
          </section>
        );
      })}
      {none.length > 0 && (
        <div className="rounded-card border border-line bg-surface px-5 py-3 text-sm text-faint">
          <div className="mb-1 text-xs font-medium">일치 없음</div>
          <ul className="space-y-0.5">{none.map((g) => <li key={g.doc.id} className="wrap-anywhere" title={groupLabel(g.doc)}>{g.doc.kindLabel} · {g.doc.label}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
