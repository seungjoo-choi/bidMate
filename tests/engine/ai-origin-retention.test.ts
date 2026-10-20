import { describe, expect, it } from 'vitest';
import { loadRules } from '../../src/core/extraction/rules/load';
import { defaultSettings } from '../../src/core/model/default-settings';
import type { Extraction } from '../../src/core/types/extraction';
import type { Job } from '../../src/core/types/job';
import type { Notice } from '../../src/core/types/notice';
import { runExtractJob } from '../../src/engine/jobs/extract-job';
import { editExtraction } from '../../src/engine/notices/notice-api';
import { docOf, fakeParsers, readJsonFile, runCollect } from '../helpers/extract-harness';

const parsers = fakeParsers(async () => docOf('차등점수제 : 미적용'));
const job: Job = {
  id: 'e1', type: 'extract', noticeId: '', status: 'running', steps: [{ id: 'extract', status: 'pending' }],
  attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
};

describe('editExtraction origin/source', () => {
  it('origin 없는 기존 호출은 그대로(ref dashboard, origin 없음)', async () => {
    const { store } = await runCollect({ files: { '1. 입찰공고문.hwp': 'x' }, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    const r = await editExtraction(store, { noticeId: id, key: 'performanceScore', value: 9, note: 'n' });
    expect(r.extraction.items.performanceScore.userEdited).not.toHaveProperty('origin');
    expect(r.notice.evaluation.performanceScore).toMatchObject({ source: { kind: 'user', ref: 'dashboard' } });
  });

  it('origin이 있는 userEdited는 재추출 뒤에도 유지된다', async () => {
    const { store } = await runCollect({ files: { '1. 입찰공고문.hwp': 'x' }, parsers });
    const id = readJsonFile<Notice>(store, '/notice.json').id;
    const origin = { kind: 'ai' as const, runId: 'r1', provider: 'claude' as const, model: 'm', promptVersion: '1.0.0' };
    await editExtraction(store, { noticeId: id, key: 'differentialScoring', value: true }, { origin, source: { ref: 'ai:r1', evidence: '근거', page: 3 } });
    const mid = readJsonFile<Notice>(store, '/notice.json');
    expect(mid.evaluation.differentialScoring).toMatchObject({ status: 'user_edited', source: { kind: 'user', ref: 'ai:r1', evidence: '근거', page: 3 } });

    const r = await runExtractJob({ job: { ...job, noticeId: id }, settings: defaultSettings() }, { store, checkPermission: async () => undefined, parsers, rules: loadRules(), emit: () => undefined });
    expect(r.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(x.items.differentialScoring.userEdited).toMatchObject({ value: true, origin });
  });
});
