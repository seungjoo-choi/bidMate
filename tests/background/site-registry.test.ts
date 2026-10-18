import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSiteRegistryDeps, syncTrackerbotScript, TRACKERBOT_SCRIPT_FILE, TRACKERBOT_SCRIPT_ID } from '../../src/background/site-registry';

const HOST = 'mail.example.com';
const PATTERN = `https://${HOST}/*`;
let registered: Array<{ id: string; matches?: string[] }>;
let granted: boolean;
const scripting = {
  getRegisteredContentScripts: vi.fn(async () => registered),
  registerContentScripts: vi.fn(async () => undefined),
  updateContentScripts: vi.fn(async () => undefined),
  unregisterContentScripts: vi.fn(async () => undefined),
  executeScript: vi.fn(async () => []),
};
const permissions = { contains: vi.fn(async () => granted) };
const tabs = { query: vi.fn(async () => [{ id: 11 }, { id: 12 }]) };

beforeEach(() => {
  vi.clearAllMocks();
  registered = []; granted = true;
  setSiteRegistryDeps({ scripting: scripting as never, permissions: permissions as never, tabs: tabs as never, getHost: async () => HOST });
});

describe('syncTrackerbotScript', () => {
  it('권한 없음 + 등록됨 -> unregister', async () => {
    granted = false; registered = [{ id: TRACKERBOT_SCRIPT_ID, matches: [PATTERN] }];
    expect(await syncTrackerbotScript()).toBe('unregistered');
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [TRACKERBOT_SCRIPT_ID] });
  });
  it('권한 없음 + 미등록 -> unchanged', async () => {
    granted = false;
    expect(await syncTrackerbotScript()).toBe('unchanged');
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });
  it('권한 있음 + 미등록 -> register(matches 정확) + 열린 탭 executeScript', async () => {
    expect(await syncTrackerbotScript()).toBe('registered');
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([{
      id: TRACKERBOT_SCRIPT_ID, js: [TRACKERBOT_SCRIPT_FILE], matches: [PATTERN], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    }]);
    expect(tabs.query).toHaveBeenCalledWith({ url: PATTERN });
    expect(scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 11 }, files: [TRACKERBOT_SCRIPT_FILE] });
  });
  it('호스트 변경 -> update', async () => {
    registered = [{ id: TRACKERBOT_SCRIPT_ID, matches: ['https://old.example.com/*'] }];
    expect(await syncTrackerbotScript()).toBe('registered');
    expect(scripting.updateContentScripts).toHaveBeenCalledOnce();
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });
  it('동일 -> unchanged, 주입 없음', async () => {
    registered = [{ id: TRACKERBOT_SCRIPT_ID, matches: [PATTERN] }];
    expect(await syncTrackerbotScript()).toBe('unchanged');
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });
  it('API 오류는 삼키고 unchanged', async () => {
    permissions.contains.mockRejectedValueOnce(new Error('boom'));
    expect(await syncTrackerbotScript()).toBe('unchanged');
  });
  it('executeScript 실패는 무시', async () => {
    scripting.executeScript.mockRejectedValue(new Error('no'));
    expect(await syncTrackerbotScript()).toBe('registered');
  });
  it('동시 호출은 직렬화된다', async () => {
    const order: string[] = [];
    scripting.getRegisteredContentScripts.mockImplementation(async () => {
      order.push('start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('end');
      return registered;
    });
    await Promise.all([syncTrackerbotScript(), syncTrackerbotScript()]);
    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });
});
