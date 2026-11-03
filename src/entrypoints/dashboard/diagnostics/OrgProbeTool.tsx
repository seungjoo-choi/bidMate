import { Search } from 'lucide-react';
import { useState } from 'react';
import { ORG_OPS, type OrgProbePart, type OrgProbeResult } from '../../../adapters/g2b/org-api';
import type { OpKind } from '../../../core/types/org';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { Code, RawDetails, ResultBlock, errText } from './parts';

const UI_TIMEOUT_MS = 70_000;
const KINDS: OpKind[] = ['Servc', 'Thng', 'Cnstwk', 'Frgcpt'];

const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** date 입력(YYYY-MM-DD) → YYYYMMDDHHMM */
const toStamp = (date: string, end: boolean): string => `${date.replace(/-/g, '')}${end ? '2359' : '0000'}`;

function PartView({ step, title, part }: { step: string; title: string; part: OrgProbePart }) {
  return (
    <ResultBlock
      tone={part.ok ? (part.count > 0 ? 'ok' : 'idle') : 'error'}
      title={<><span className="font-normal text-muted">{step}</span> {title}</>}
      meta={<>{part.ok ? `${part.count}건` : '실패'} · {part.ms}ms</>}
    >
      {!part.ok && <div className="text-danger wrap-anywhere">{part.error ?? '응답을 받지 못했습니다.'}</div>}
      {part.ok && part.count > 0 && (
        <>
          <div className="text-xs text-muted wrap-anywhere">
            <span className="font-medium text-ink">필드 {part.keys.length}개</span> · {part.keys.join(', ')}
          </div>
          <RawDetails summary="응답 예시 보기">
            <Code>{JSON.stringify(part.sample, null, 2)}</Code>
          </RawDetails>
        </>
      )}
    </ResultBlock>
  );
}

export function OrgProbeTool() {
  const [orgCode, setOrgCode] = useState('Z004560');
  const [kind, setKind] = useState<OpKind>('Servc');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return ymd(d); });
  const [to, setTo] = useState(() => ymd(new Date()));
  const [noticeOp, setNoticeOp] = useState<string>(ORG_OPS.noticeSearch);
  const [awardOp, setAwardOp] = useState<string>(ORG_OPS.awardSearch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrgProbeResult | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    if (!orgCode.trim()) { setError('기관코드를 입력하세요. 예: Z004560'); return; }
    if (!from || !to) { setError('기간을 입력하세요.'); return; }
    setBusy(true);
    try {
      setResult(await send('org/probe', {
        orgCode: orgCode.trim(), kind, from: toStamp(from, false), to: toStamp(to, true),
        noticeOp: noticeOp.trim(), awardOp: awardOp.trim(),
      }, { timeoutMs: UI_TIMEOUT_MS }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">기관 코드로 기간 검색한 공고·낙찰 목록 API 응답을 확인합니다. 창 1개만 호출하며 저장하지 않습니다. 오퍼레이션 이름의 {'{Kind}'}는 업무 구분으로 바뀝니다.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="diag-org-code" className="sr-only">기관코드</label>
        <input id="diag-org-code" className={`${inputClass} w-40 font-mono tabular-nums`} placeholder="기관코드" value={orgCode} onChange={(e) => setOrgCode(e.target.value)} />
        <label htmlFor="diag-org-kind" className="sr-only">업무 구분</label>
        <select id="diag-org-kind" className={`${inputClass} w-32`} value={kind} onChange={(e) => setKind(e.target.value as OpKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label htmlFor="diag-org-from" className="sr-only">시작일</label>
        <input id="diag-org-from" type="date" className={`${inputClass} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-muted">~</span>
        <label htmlFor="diag-org-to" className="sr-only">종료일</label>
        <input id="diag-org-to" type="date" className={`${inputClass} w-40`} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="diag-org-nop" className="text-xs text-muted">공고 오퍼레이션</label>
          <input id="diag-org-nop" className={`${inputClass} w-full font-mono text-xs`} value={noticeOp} onChange={(e) => setNoticeOp(e.target.value)} />
        </div>
        <div>
          <label htmlFor="diag-org-aop" className="text-xs text-muted">낙찰 오퍼레이션</label>
          <input id="diag-org-aop" className={`${inputClass} w-full font-mono text-xs`} value={awardOp} onChange={(e) => setAwardOp(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button icon={<Search />} loading={busy} onClick={() => void run()}>시험</Button>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {result && (
        <div className="space-y-3">
          <PartView step="1단계" title={result.notice.op} part={result.notice} />
          <PartView step="2단계" title={result.award.op} part={result.award} />
        </div>
      )}
    </div>
  );
}
