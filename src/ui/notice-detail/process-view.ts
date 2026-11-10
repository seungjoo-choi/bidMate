import type { ContractProcess, ProcessGetResult, ProcessRound } from '../../core/types/process';
import { formatAmountFull, formatAmountShort, formatDate, formatDateTime } from '../review/format';
import type { DetailRow, Milestone } from './view';

const EMPTY = '—';

const lastRound = (p: ContractProcess): ProcessRound | undefined => p.rounds[p.rounds.length - 1];

/** 발주계획 → 사전규격 → 공고(차수별) → 낙찰 → 계약. 마지막 차수의 낙찰·계약만 본다. */
export function processMilestones(p: ContractProcess): Milestone[] {
  const out: Milestone[] = [];
  out.push(p.orderPlan
    ? { key: 'orderPlan', label: '발주계획', when: p.orderPlan.ym ?? EMPTY, sub: p.orderPlan.no, dday: null, state: 'done' }
    : { key: 'orderPlan', label: '발주계획', when: EMPTY, dday: null, state: 'upcoming' });
  out.push(p.prespec
    ? { key: 'prespec', label: '사전규격', when: formatDate(p.prespec.opinionCloseAt), sub: p.prespec.regNo, dday: null, state: 'done' }
    : { key: 'prespec', label: '사전규격', when: EMPTY, dday: null, state: 'upcoming' });
  if (p.rounds.length === 0) {
    out.push({ key: 'round', label: '공고', when: EMPTY, dday: null, state: 'upcoming' });
  } else {
    for (const r of p.rounds) {
      out.push({
        key: `round-${r.round}`,
        label: p.rounds.length === 1 ? '공고' : `공고 ${Number(r.round)}차`,
        when: formatDate(r.postedAt),
        sub: `${r.noticeNo}-${r.round}`,
        dday: null,
        state: 'done',
      });
    }
  }
  const last = lastRound(p);
  const winners = last?.winners ?? [];
  const w = winners[0];
  if (w) {
    out.push({
      key: 'award', label: '낙찰', when: formatDate(w.openedAt),
      sub: w.amount === null ? w.name : `${w.name} ${formatAmountShort(w.amount)}`,
      dday: null, state: 'done',
    });
  } else {
    out.push({ key: 'award', label: '낙찰', when: EMPTY, dday: null, state: 'upcoming' });
  }
  const contracts = last?.contracts ?? [];
  if (contracts.length > 0) {
    const times = contracts.map((c) => (c.contractedAt ? new Date(c.contractedAt).getTime() : NaN)).filter(Number.isFinite);
    const earliest = times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
    const total = contracts.reduce((s, c) => s + (c.amount ?? 0), 0);
    out.push({
      key: 'contract', label: '계약', when: formatDate(earliest),
      sub: contracts.length === 1 ? (contracts[0]?.name ?? EMPTY) : `${contracts.length}건 ${formatAmountShort(total)}`,
      dday: null, state: 'done',
    });
  } else {
    out.push({ key: 'contract', label: '계약', when: EMPTY, dday: null, state: 'upcoming' });
  }
  return out;
}

export function processWinnerRows(p: ContractProcess): DetailRow[] {
  const winners = lastRound(p)?.winners ?? [];
  const multi = winners.length > 1;
  return winners.flatMap((w): DetailRow[] => {
    const n = multi ? ` ${w.seq}` : '';
    return [
      { label: `낙찰자${n}`, value: w.name ? `${w.name} (${w.bizNo || EMPTY})` : EMPTY },
      { label: `낙찰금액${n}`, value: formatAmountFull(w.amount) + (w.rate !== null ? ` (낙찰률 ${w.rate}%)` : '') },
      { label: `참가업체${n}`, value: w.bidders !== null ? `${w.bidders}개사` : EMPTY },
      { label: `개찰일시${n}`, value: formatDateTime(w.openedAt) },
    ];
  });
}

export function processContractRows(p: ContractProcess): DetailRow[] {
  const contracts = lastRound(p)?.contracts ?? [];
  const multi = contracts.length > 1;
  return contracts.map((c) => {
    const hint = [c.contractNo, c.contractOrg, c.method, c.amount !== null ? formatAmountFull(c.amount) : '', c.contractedAt ? formatDateTime(c.contractedAt) : '']
      .filter((s): s is string => !!s)
      .join(' / ');
    return { label: multi ? `계약 ${c.seq}` : '계약', value: c.name || EMPTY, ...(hint ? { hint } : {}) };
  });
}

export function processStatusLine(r: ProcessGetResult): { text: string; tone: 'muted' | 'warn' | 'error' } {
  if (r.error) {
    return r.error.code === 'G2B_KEY_MISSING'
      ? { text: '서비스키가 없어 조회하지 못했습니다', tone: 'warn' }
      : { text: `조회 실패: ${r.error.message}`, tone: 'error' };
  }
  const at = formatDateTime(r.file?.fetchedAt);
  if (r.file && !r.file.process) return { text: `계약과정 정보가 없습니다 (${at} 조회)`, tone: 'muted' };
  return { text: `${at} 조회${r.fromCache ? ' (저장된 값)' : ''}`, tone: 'muted' };
}
