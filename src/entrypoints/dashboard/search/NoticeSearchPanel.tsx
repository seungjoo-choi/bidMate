import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SEARCH_MAX_HITS_PER_DOC } from '../../../core/search/constants';
import { searchDoc } from '../../../core/search/match';
import { parseQuery } from '../../../core/search/normalize';
import { buildUnits } from '../../../core/search/units';
import type { SearchGroup } from '../../../core/search/types';
import type { Extraction } from '../../../core/types/extraction';
import type { Notice } from '../../../core/types/notice';
import type { NoticeTexts } from '../../../core/types/search';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { buildSearchDocs, drawerTargetOf, pageMap } from '../../../ui/search/search-view';
import { FsErrorAlert, type FsErrorInfo } from '../FsErrorAlert';
import { TextDrawer, type DrawerTarget } from '../review/TextDrawer';
import { AskPanel } from './AskPanel';
import { SearchResults } from './SearchResults';

const DEBOUNCE_MS = 150;
const TEXTS_TIMEOUT_MS = 65_000;

interface Loaded { notice: Notice; extraction: Extraction | null; texts: NoticeTexts }

/** notice/texts 응답은 공고 1건만 캐시한다. 패널을 닫았다 다시 열어도 같은 공고면 다시 읽지 않고, extraction이나 상세 전문 저장 시각이 바뀌었으면 다시 읽는다. */
let cache: { noticeId: string; detailAt: string; texts: NoticeTexts } | null = null;

async function loadCorpus(noticeId: string): Promise<Loaded> {
  const cached = cache?.noticeId === noticeId ? cache : null;
  const gotP = send('notice/get', { noticeId });
  const textsP = cached ? null : send('notice/texts', { noticeId }, { timeoutMs: TEXTS_TIMEOUT_MS });
  textsP?.catch(() => undefined);
  const got = await gotP;
  if (!got) throw new Error('공고를 찾을 수 없습니다.');
  const jobId = got.extraction?.jobId ?? null;
  const detailAt = got.notice.detailText?.capturedAt ?? '';
  const fresh = cached && cached.texts.extractionJobId === jobId && cached.detailAt === detailAt;
  const texts = fresh ? cached.texts : await (textsP ?? send('notice/texts', { noticeId }, { timeoutMs: TEXTS_TIMEOUT_MS }));
  cache = { noticeId, detailAt, texts };
  return { notice: got.notice, extraction: got.extraction, texts };
}

const toErrorInfo = (e: unknown): FsErrorInfo => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

/** 오른쪽 슬라이드 패널. 공고 하나의 항목값·상세 전문·첨부 txt를 한 번에 키워드 검색한다. */
export function NoticeSearchPanel({ noticeId, title, initialQuery, onClose }: { noticeId: string; title: string; initialQuery: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<FsErrorInfo | null>(null);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [askSeed, setAskSeed] = useState('');

  const close = () => { setShown(false); setTimeout(onClose, 200); };

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Escape는 TextDrawer가 열려 있지 않을 때만 패널을 닫는다.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && !drawer) close(); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  });
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const load = () => {
    setError(null);
    loadCorpus(noticeId).then(setData, (e: unknown) => setError(toErrorInfo(e)));
  };
  useEffect(() => {
    let alive = true;
    loadCorpus(noticeId).then(
      (d) => { if (alive) setData(d); },
      (e: unknown) => { if (alive) setError(toErrorInfo(e)); },
    );
    return () => { alive = false; };
  }, [noticeId]);

  // 문서→유닛은 데이터를 받았을 때 1회만 계산한다.
  const corpus = useMemo(() => {
    if (!data) return null;
    const docs = buildSearchDocs(data.notice, data.extraction, data.texts);
    return { docs, units: docs.map((d) => buildUnits(d.lines)), pages: new Map(docs.filter((d) => d.kind !== 'fields').map((d) => [d.id, pageMap(d.lines)])) };
  }, [data]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const queryOk = parsed.terms.length > 0 || parsed.phrases.length > 0;
  const groups = useMemo<SearchGroup[]>(() => {
    if (!corpus || !queryOk) return [];
    return corpus.docs.map((doc, i) => {
      const { hits, total } = searchDoc(doc, corpus.units[i]!, parsed);
      return { doc, hits, total, truncated: total > hits.length };
    });
  }, [corpus, parsed, queryOk]);

  const heading = data?.notice.basic.title.value || title;
  const total = groups.reduce((n, g) => n + g.total, 0);
  const docCount = groups.filter((g) => g.total > 0).length;
  const hasDetail = !!data && data.texts.files.some((f) => f.kind === 'detail' && f.text !== '');
  const skipped = data?.texts.skipped ?? [];

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
      <aside
        role="dialog"
        aria-label="공고 통합검색"
        className={`fixed right-0 top-0 z-[45] flex h-full w-[min(760px,60vw)] flex-col border-l border-line bg-surface shadow-overlay transition-transform duration-200 motion-reduce:transition-none ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1 text-base leading-snug font-semibold wrap-anywhere">{heading}</div>
          <Button variant="ghost" size="icon" aria-label="닫기" icon={<X />} onClick={close} />
        </header>
        <div role="tablist" aria-label="모드" className="flex gap-1 border-b border-line px-5 pt-2">
          {([['search', '검색'], ['ask', '질문(AI)']] as const).map(([m, label]) => (
            <button
              key={m} type="button" role="tab" aria-selected={mode === m}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-semibold ${mode === m ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'}`}
              onClick={() => { if (m === 'ask') setAskSeed(input); setMode(m); }}
            >{label}</button>
          ))}
        </div>
        <div className={mode === 'search' ? 'contents' : 'hidden'}>
        <div className="flex items-center gap-1.5 border-b border-line px-5 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              autoFocus className={`${inputClass} pl-8`} placeholder="이 공고의 모든 문서에서 검색" aria-label="통합검색어" value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <span className="w-36 text-right text-xs text-muted tabular-nums">{queryOk && corpus ? `총 ${total}건 · 문서 ${docCount}개` : ''}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {error && <FsErrorAlert error={error} onRetry={load} />}
          {!data && !error && <div className="flex justify-center p-8 text-muted"><Loader2 className="size-5 animate-spin" /></div>}
          {data && !hasDetail && <InlineAlert tone="info">이 공고는 나라장터 상세화면 전문 없이 수집되어 상세화면은 검색되지 않습니다. 나라장터에서 다시 수집하면 포함됩니다.</InlineAlert>}
          {skipped.length > 0 && <InlineAlert tone="warn">일부 문서는 검색에서 제외했습니다(읽기 실패 또는 용량 초과): {skipped.map((s) => s.name).join(', ')}</InlineAlert>}
          {data && !input.trim() && <div className="p-8 text-center text-sm text-muted">검색어를 입력하세요. 항목값, 나라장터 상세화면, 첨부 문서를 한꺼번에 찾습니다. 띄어쓰기는 무시하고, 여러 단어는 모두 포함한 곳을 찾으며, 큰따옴표로 묶으면 구문으로 찾습니다.</div>}
          {data && input.trim() && !queryOk && query === input && <div className="p-8 text-center text-sm text-muted">두 글자 이상 입력하세요.</div>}
          {corpus && queryOk && (
            <>
              {total === 0 && <div className="p-8 text-center text-sm text-muted">일치하는 내용이 없습니다.</div>}
              <SearchResults
                groups={groups} pages={corpus.pages} limit={SEARCH_MAX_HITS_PER_DOC} onNavigate={close}
                onOpenHit={(hit, doc) => { const t = drawerTargetOf(hit, doc, parsed); if (t) setDrawer(t); }}
              />
            </>
          )}
        </div>
        </div>
        {mode === 'ask' && !corpus && (
          <div className="px-5 py-4">
            {error ? <FsErrorAlert error={error} onRetry={load} /> : <div className="flex justify-center p-8 text-muted"><Loader2 className="size-5 animate-spin" /></div>}
          </div>
        )}
        {corpus && data && (
          <div className={mode === 'ask' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <AskPanel
              noticeId={noticeId} docs={corpus.docs} units={corpus.units} seed={askSeed}
              extractionJobId={data.texts.extractionJobId} detailCapturedAt={data.notice.detailText?.capturedAt ?? ''}
              onOpen={setDrawer} onNavigate={close}
            />
          </div>
        )}
      </aside>
      {drawer && <TextDrawer noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
    </>
  );
}
