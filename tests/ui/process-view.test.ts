import { describe, expect, it } from 'vitest';
import { mapProcess } from '../../src/adapters/g2b/process-api';
import type { ContractProcess, ProcessGetResult } from '../../src/core/types/process';
import { processContractRows, processMilestones, processStatusLine, processWinnerRows } from '../../src/ui/notice-detail/process-view';
import fx from '../fixtures/g2b-process-R26BK01470335.json';

const items = (fx as { response: { body: { items: Array<Record<string, string>> } } }).response.body.items;
const full = mapProcess(items) as ContractProcess;
const first = { ...full, rounds: full.rounds.slice(0, 1) };
const byKey = (p: ContractProcess, k: string) => processMilestones(p).find((m) => m.key === k)!;

describe('processMilestones', () => {
  it('키 순서와 공고 라벨', () => {
    const ms = processMilestones(full);
    expect(ms.map((m) => m.key)).toEqual(['orderPlan', 'prespec', 'round-000', 'round-001', 'award', 'contract']);
    expect(ms[2]?.label).toBe('공고 0차');
    expect(ms[3]?.label).toBe('공고 1차');
  });
  it('낙찰·계약 done, sub 내용', () => {
    expect(byKey(full, 'award').state).toBe('done');
    expect(byKey(full, 'award').sub).toContain('주식회사 티에스산업');
    expect(byKey(full, 'contract').state).toBe('done');
    expect(byKey(full, 'contract').sub).toContain('2건');
  });
  it('000차만 남기면 낙찰·계약 upcoming, 유찰 표기 없음', () => {
    const ms = processMilestones(first);
    for (const k of ['award', 'contract']) {
      const m = ms.find((x) => x.key === k)!;
      expect(m.state).toBe('upcoming');
      expect(m.when).toBe('—');
    }
    expect(JSON.stringify({ ms, w: processWinnerRows(first), c: processContractRows(first) })).not.toContain('유찰');
  });
  it('rounds 빈 배열이면 round upcoming 1점', () => {
    const ms = processMilestones({ ...full, rounds: [] }).filter((m) => m.key.startsWith('round'));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ key: 'round', state: 'upcoming' });
  });
  it('차수 하나면 라벨 공고', () => {
    expect(byKey(first, 'round-000').label).toBe('공고');
  });
});

describe('rows', () => {
  it('계약 2행, hint에 계약번호', () => {
    const rows = processContractRows(full);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.hint).join('|')).toContain('R26TA0182919201');
  });
  it('낙찰 행에 낙찰률', () => {
    expect(processWinnerRows(full).some((r) => r.value.includes('낙찰률'))).toBe(true);
  });
});

describe('processStatusLine', () => {
  const file = (process: ContractProcess | null) => ({ schemaVersion: 1 as const, noticeId: 'n', queryNoticeNo: 'q', op: null, fetchedAt: '2026-01-02T03:04:00+09:00', process });
  it('키 없음', () => {
    const r: ProcessGetResult = { file: null, fromCache: false, error: { code: 'G2B_KEY_MISSING', message: 'x' } };
    expect(processStatusLine(r)).toEqual({ text: '서비스키가 없어 조회하지 못했습니다', tone: 'warn' });
  });
  it('그 외 오류', () => {
    const r: ProcessGetResult = { file: null, fromCache: false, error: { code: 'X', message: '시간 초과' } };
    expect(processStatusLine(r)).toEqual({ text: '조회 실패: 시간 초과', tone: 'error' });
  });
  it('정보 없음', () => {
    const s = processStatusLine({ file: file(null), fromCache: false });
    expect(s.tone).toBe('muted');
    expect(s.text).toContain('계약과정 정보가 없습니다');
  });
  it('정상, 캐시', () => {
    expect(processStatusLine({ file: file(full), fromCache: false }).text).toMatch(/ 조회$/);
    expect(processStatusLine({ file: file(full), fromCache: true }).text).toMatch(/ 조회 \(저장된 값\)$/);
  });
});
