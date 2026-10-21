import { Fragment, type ReactNode } from 'react';
import type { DiffSegment, LineOp } from '../../../core/types/rfp';

export type DiffSide = 'prev' | 'next' | 'both';

const LN = '-mx-2 rounded px-2 py-px [&+&]:mt-[3px]';
export const LN_DEL = `${LN} bg-diff-del shadow-[inset_3px_0_0_var(--color-danger)]`;
export const LN_INS = `${LN} bg-diff-ins shadow-[inset_3px_0_0_var(--color-ok)]`;

/** 표 행(칸=탭)의 칸 구분선 */
const Sep = () => <span aria-hidden className="mx-2.5 inline-block h-3.5 w-px bg-line-strong align-[-2px]" />;

/** 탭을 칸 구분선으로 바꿔 그린다. */
export function cells(text: string): ReactNode {
  if (!text.includes('\t')) return text;
  return text.split('\t').map((t, i) => <Fragment key={i}>{i > 0 && <Sep />}{t}</Fragment>);
}

function Segs({ segs, side }: { segs: DiffSegment[]; side: DiffSide }) {
  return (
    <>
      {segs.map((s, i) => {
        if (s.op === 'eq') return <span key={i}>{cells(s.text)}</span>;
        if (s.op === 'del') {
          if (side === 'next') return null;
          return <del key={i} className={`rounded-sm px-px line-through decoration-danger/60 ${s.fine ? 'bg-diff-del-strong' : 'bg-diff-del'}`}>{cells(s.text)}</del>;
        }
        if (side === 'prev') return null;
        return <ins key={i} className={`rounded-sm px-px no-underline ${s.fine ? 'bg-diff-ins-strong' : 'bg-diff-ins'}`}>{cells(s.text)}</ins>;
      })}
    </>
  );
}

/** diffLines 결과를 한 열에 줄 단위로 그린다(한 줄로 보기). */
export function LineDiff({ ops, side }: { ops: LineOp[]; side: DiffSide }) {
  return (
    <>
      {ops.map((o, i) => {
        if (o.op === 'eq') return <div key={i} className={LN}>{cells(side === 'next' ? o.next : o.prev)}</div>;
        if (o.op === 'del') return side === 'next' ? null : <div key={i} className={LN_DEL}>{cells(o.prev)}</div>;
        if (o.op === 'ins') return side === 'prev' ? null : <div key={i} className={LN_INS}>{cells(o.next)}</div>;
        return <div key={i} className={LN}><Segs segs={o.segs} side={side} /></div>;
      })}
    </>
  );
}

type Half = { kind: 'eq' | 'del' | 'ins' | 'mod' | 'none'; op?: LineOp };
export interface SplitRow { l: Half; r: Half }

/**
 * 나란히 보기용 정렬: 같은 줄·고친 줄은 같은 행에, 그 사이 빠진 줄·새 줄은 위에서부터 서로 마주 보게 놓고
 * 모자란 쪽은 빈칸으로 채운다. 그래서 왼쪽·오른쪽 같은 내용이 항상 같은 높이에 온다.
 */
export function alignOps(ops: LineOp[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: LineOp[] = [], inss: LineOp[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, inss.length); i++) {
      out.push({ l: dels[i] ? { kind: 'del', op: dels[i] } : { kind: 'none' }, r: inss[i] ? { kind: 'ins', op: inss[i] } : { kind: 'none' } });
    }
    dels = []; inss = [];
  };
  for (const o of ops) {
    if (o.op === 'del') dels.push(o);
    else if (o.op === 'ins') inss.push(o);
    else { flush(); out.push({ l: { kind: o.op, op: o }, r: { kind: o.op, op: o } }); }
  }
  flush();
  return out;
}

const HALF = 'min-w-0 whitespace-pre-wrap px-3.5 py-[3px] text-sm leading-6 [overflow-wrap:anywhere]';
const HALF_BG: Record<Half['kind'], string> = {
  eq: '', mod: '',
  del: 'bg-diff-del shadow-[inset_3px_0_0_var(--color-danger)]',
  ins: 'bg-diff-ins shadow-[inset_3px_0_0_var(--color-ok)]',
  none: '[background:repeating-linear-gradient(135deg,transparent_0_6px,var(--color-sunken)_6px_7px)]',
};

function halfText(h: Half, side: 'prev' | 'next'): ReactNode {
  const o = h.op;
  if (!o) return null;
  if (o.op === 'mod') return <Segs segs={o.segs} side={side} />;
  if (o.op === 'eq') return cells(side === 'prev' ? o.prev : o.next);
  if (o.op === 'del') return cells(o.prev);
  return cells(o.next);
}

/** 나란히 보기: 왼쪽 비교 대상, 오른쪽 기준. 행마다 좌우 높이를 맞춘다. */
export function SplitDiff({ ops }: { ops: LineOp[] }) {
  const rows = alignOps(ops);
  return (
    <div className="relative grid grid-cols-2">
      {rows.map((row, i) => (
        <Fragment key={i}>
          <div className={`${HALF} ${HALF_BG[row.l.kind]}`}>{halfText(row.l, 'prev')}</div>
          <div className={`${HALF} ${HALF_BG[row.r.kind]}`}>{halfText(row.r, 'next')}</div>
        </Fragment>
      ))}
    </div>
  );
}
