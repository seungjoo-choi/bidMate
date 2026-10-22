import { describe, expect, it } from 'vitest';
import type { EvalRaw } from '../../src/adapters/g2b/eval-api';
import { mapEvalRaw } from '../../src/core/evaluation/map';
import { saveEval } from '../../src/engine/evaluation/eval-api';
import { EvalStore } from '../../src/engine/evaluation/eval-store';
import raw from '../fixtures/eval-raw-sample.json';
import { MemoryStore } from '../helpers/memory-store';

const REF = { noticeNo: 'R26BK01631407', round: '000' };
const ID = 'R26BK01631407-000';
const mk = (nowIso: string, noticeNo = REF.noticeNo) => {
  const r = mapEvalRaw(raw as EvalRaw, { noticeNo, round: '000' }, nowIso);
  if (!r.ok) throw new Error(r.message);
  return r.record;
};
const officialFetch = ((async () => ({
  status: 200,
  text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [{ opengRank: '1', prcbdrBizno: '5978600662', bidprcAmt: '1' }] } } }),
}) as Response) as unknown) as typeof fetch;

describe('EvalStore', () => {
  it('저장하면 파일과 index가 생기고 firstCollectedAt을 승계한다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await st.save(mk('2026-10-01T00:00:00.000Z'));
    await st.save(mk('2026-10-19T00:00:00.000Z'));
    const got = await st.get(ID);
    expect(got?.collectedAt).toBe('2026-10-19T00:00:00.000Z');
    expect(got?.firstCollectedAt).toBe('2026-10-01T00:00:00.000Z');
    const idx = await st.loadIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0]).toMatchObject({ noticeId: ID, judgeKeys: ['J001', 'J002', 'J003', 'J004', 'J005', 'J006', 'J007', 'J008'], hasOfficial: false });
  });

  it('index가 없거나 손상되면 스캔으로 재생성하고 crswap은 무시한다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await st.save(mk('2026-10-01T00:00:00.000Z'));
    await st.save(mk('2026-10-01T00:00:00.000Z', 'R26BK01631408'));
    await mem.writeText('evaluations/index.json', '{broken');
    await mem.writeText(`evaluations/${ID}.json.crswap`, 'garbage');
    const idx = await st.loadIndex();
    expect(idx.entries.map((e) => e.noticeId).sort()).toEqual([ID, 'R26BK01631408-000']);
  });

  it('getMany는 ids 또는 전체, remove는 파일과 index 항목을 지운다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await st.save(mk('2026-10-01T00:00:00.000Z'));
    await st.save(mk('2026-10-01T00:00:00.000Z', 'R26BK01631408'));
    expect(await st.getMany()).toHaveLength(2);
    expect((await st.getMany([ID, 'R26BK09999999-000'])).map((r) => r.noticeId)).toEqual([ID]);
    expect(await st.remove(ID)).toBe(true);
    expect(await st.remove(ID)).toBe(false);
    expect(await st.get(ID)).toBeNull();
    expect((await st.loadIndex()).entries.map((e) => e.noticeId)).toEqual(['R26BK01631408-000']);
  });

  it('형식이 틀린 ID는 거부한다', async () => {
    const st = new EvalStore(new MemoryStore());
    await expect(st.get('../x')).rejects.toMatchObject({ code: 'EVAL_BAD_ID' });
  });
});

describe('EvalStore 동시성과 재생성', () => {
  it('같은 noticeId를 동시에 두 번 저장해도 index 항목은 1개이고 collectedAt이 일치한다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await Promise.all([st.save(mk('2026-10-01T00:00:00.000Z')), st.save(mk('2026-10-19T00:00:00.000Z'))]);
    const idx = await st.loadIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0]!.collectedAt).toBe((await st.get(ID))!.collectedAt);
  });

  it('save와 remove를 동시에 해도 파일과 index가 서로 맞는다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await st.save(mk('2026-10-01T00:00:00.000Z'));
    await Promise.all([st.save(mk('2026-10-19T00:00:00.000Z')), st.remove(ID)]);
    const file = await st.get(ID);
    const inIndex = (await st.loadIndex()).entries.some((e) => e.noticeId === ID);
    expect(inIndex).toBe(file !== null);
  });

  it('index.json이 없는 상태에서 loadIndex와 save를 동시에 실행해도 항목이 정확히 1개이고 파일과 일치한다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    const [, saved] = await Promise.all([st.loadIndex(), st.save(mk('2026-10-19T00:00:00.000Z'))]);
    const idx = await st.loadIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0]!.collectedAt).toBe(saved.collectedAt);
    expect(idx.entries[0]!.collectedAt).toBe((await st.get(ID))!.collectedAt);
  });

  it('사본 파일은 재생성 index에 들어가지 않는다', async () => {
    const mem = new MemoryStore();
    const st = new EvalStore(mem);
    await st.save(mk('2026-10-01T00:00:00.000Z'));
    await mem.writeText(`evaluations/${ID} copy.json`, await mem.readText(`evaluations/${ID}.json`));
    await mem.remove('evaluations/index.json');
    expect((await st.loadIndex()).entries.map((e) => e.noticeId)).toEqual([ID]);
  });

  it('list가 NotFoundError가 아닌 오류를 던지면 loadIndex도 던지고 index를 쓰지 않는다', async () => {
    const mem = new MemoryStore();
    mem.list = async () => { throw Object.assign(new Error('io'), { name: 'NotReadableError' }); };
    await expect(new EvalStore(mem).loadIndex()).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(mem.files.has('evaluations/index.json')).toBe(false);
  });
});

describe('saveEval', () => {
  it('공식 결과를 붙여 저장한다', async () => {
    const mem = new MemoryStore();
    const r = await saveEval(mem, { ref: REF, raw: raw as EvalRaw, serviceKey: 'KEY' }, { fetch: officialFetch, now: () => new Date('2026-10-19T00:00:00Z') });
    expect(r.noticeId).toBe(ID);
    expect(r.entry.hasOfficial).toBe(true);
    expect((await new EvalStore(mem).get(ID))?.official?.rows[0]).toMatchObject({ bizNo: '5978600662', rank: 1 });
  });

  it('서비스키가 없거나 공식 조회가 실패하면 경고만 남기고 저장한다', async () => {
    const mem = new MemoryStore();
    const noKey = await saveEval(mem, { ref: REF, raw: raw as EvalRaw }, { fetch: officialFetch });
    expect(noKey.entry.hasOfficial).toBe(false);
    expect(noKey.warnings).toHaveLength(1);
    const bad = (async () => ({ status: 500, text: async () => 'x' }) as Response) as unknown as typeof fetch;
    const failed = await saveEval(mem, { ref: REF, raw: raw as EvalRaw, serviceKey: 'KEY' }, { fetch: bad });
    expect(failed.entry.hasOfficial).toBe(false);
    expect(failed.warnings.some((w) => w.includes('공식 결과'))).toBe(true);
  });

  it('공식 조회 실패 시 onFailure(official)를 보고하고 경고는 유지한다', async () => {
    const mem = new MemoryStore();
    const bad = (async () => ({ status: 500, text: async () => 'x' }) as Response) as unknown as typeof fetch;
    const calls: unknown[] = [];
    const r = await saveEval(mem, { ref: REF, raw: raw as EvalRaw, serviceKey: 'KEY' }, { fetch: bad, onFailure: (f) => calls.push(f) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ flow: 'eval', stage: 'official', noticeNo: REF.noticeNo, trigger: 'eval-save', httpStatus: 500 });
    expect(r.warnings.some((w) => w.includes('공식 결과'))).toBe(true);
  });

  it('가져오기 경고를 record.warnings 앞쪽에 합친다', async () => {
    const mem = new MemoryStore();
    const r = await saveEval(mem, { ref: REF, raw: raw as EvalRaw, fetchWarnings: ['CS 경고'] }, { fetch: officialFetch });
    expect(r.warnings[0]).toBe('CS 경고');
    expect((await new EvalStore(mem).get(ID))!.warnings[0]).toBe('CS 경고');
  });

  it('매핑 실패는 EVAL_PARSE로 던지고 저장하지 않는다', async () => {
    const mem = new MemoryStore();
    const x = { ...(raw as EvalRaw), scores: [] };
    await expect(saveEval(mem, { ref: REF, raw: x })).rejects.toMatchObject({ code: 'EVAL_PARSE' });
    expect(mem.files.size).toBe(0);
  });
});
