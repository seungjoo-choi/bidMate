import { describe, expect, it } from 'vitest';
import { builtinDefaultTemplate, builtinPrespecTemplate, TEMPLATE_DEFAULT_ID, TEMPLATE_PRESPEC_DEFAULT_ID } from '../../src/core/templates/default-template';
import { CONFIG_PATHS } from '../../src/engine/config/config-store';
import { deleteTemplate, listTemplates, saveTemplate, setDefaultTemplate } from '../../src/engine/config/templates-api';
import type { TemplateInput } from '../../src/core/types/config-file';
import type { Template } from '../../src/core/types/template';
import { MemoryStore } from '../helpers/memory-store';

const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => e.code as string);
const input = (o: Partial<TemplateInput> = {}): TemplateInput => ({
  name: '내 템플릿', subject: '[공유] {공고명}', greeting: '안녕하세요', closing: '감사합니다', layout: 'table',
  sections: [{ id: 's1', title: '개요', items: [{ fieldKey: 'title', label: '사업명', visible: true }] }], ...o,
});

describe('templates-api', () => {
  it('파일이 없으면 내장 기본(+내장 사전규격)을 돌려주고 파일을 만들지 않는다', async () => {
    const mem = new MemoryStore();
    const snap = await listTemplates(mem);
    expect(snap.templates).toHaveLength(2);
    expect(snap.templates[0]!.id).toBe(TEMPLATE_DEFAULT_ID);
    expect(snap.templates[0]!.isDefault).toBe(true);
    expect(mem.files.size).toBe(0);
  });
  it('첫 저장에 목록 전체(내장 기본 포함)를 기록한다', async () => {
    const mem = new MemoryStore();
    const snap = await saveTemplate(mem, input());
    expect(snap.templates.map((t) => t.name)).toEqual([builtinDefaultTemplate(new Date()).name, '내 템플릿', builtinPrespecTemplate(new Date()).name]);
    expect(snap.templates[1]!.isDefault).toBe(false);
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.templates)).items).toHaveLength(3);
  });
  it('기존 템플릿을 id로 수정하고 없는 id는 NOT_FOUND', async () => {
    const mem = new MemoryStore();
    const snap = await saveTemplate(mem, input({ id: TEMPLATE_DEFAULT_ID, name: '수정됨' }));
    expect(snap.templates).toHaveLength(2);
    expect(snap.templates[0]!.name).toBe('수정됨');
    expect(snap.templates[0]!.isDefault).toBe(true);
    expect(await codeOf(saveTemplate(mem, input({ id: 'nope' })))).toBe('NOT_FOUND');
  });
  it('알 수 없는 fieldKey와 잘못된 값은 INVALID_VALUE로 거부한다', async () => {
    const mem = new MemoryStore();
    const bad = input({ sections: [{ id: 's', title: 't', items: [{ fieldKey: 'nope' as never, label: 'x', visible: true }] }] });
    expect(await codeOf(saveTemplate(mem, bad))).toBe('INVALID_VALUE');
    expect(await codeOf(saveTemplate(mem, input({ name: ' ' })))).toBe('INVALID_VALUE');
    expect(await codeOf(saveTemplate(mem, input({ sections: 'x' as never })))).toBe('INVALID_VALUE');
    expect(mem.files.size).toBe(0);
    const ok = input({ sections: [{ id: 's', title: 't', items: [{ fieldKey: 'custom.foo', label: 'x', visible: true }] }] });
    expect((await saveTemplate(mem, ok)).templates).toHaveLength(3);
  });
  it('마지막 1개는 LAST_TEMPLATE으로 삭제할 수 없다', async () => {
    const mem = new MemoryStore();
    expect(await codeOf(deleteTemplate(mem, TEMPLATE_DEFAULT_ID))).toBe('LAST_TEMPLATE');
    expect(await codeOf(deleteTemplate(mem, TEMPLATE_PRESPEC_DEFAULT_ID))).toBe('LAST_TEMPLATE');
    expect(await codeOf(deleteTemplate(mem, 'nope'))).toBe('NOT_FOUND');
  });
  it('기본을 지우면 남은 첫 항목이 기본이 된다', async () => {
    const mem = new MemoryStore();
    await saveTemplate(mem, input());
    const snap = await deleteTemplate(mem, TEMPLATE_DEFAULT_ID);
    expect(snap.templates).toHaveLength(2);
    expect(snap.templates[0]!.name).toBe('내 템플릿');
    expect(snap.templates[0]!.isDefault).toBe(true);
    expect(JSON.parse(await mem.readText(CONFIG_PATHS.templates)).items[0].isDefault).toBe(true);
  });
  it('set-default는 그 템플릿만 기본으로 만든다', async () => {
    const mem = new MemoryStore();
    const id = (await saveTemplate(mem, input())).templates[1]!.id;
    const snap = await setDefaultTemplate(mem, id);
    expect(snap.templates.map((t) => t.isDefault)).toEqual([false, true, true]);
    expect(await codeOf(setDefaultTemplate(mem, 'nope'))).toBe('NOT_FOUND');
  });
  it('layout이 table/list가 아니면 INVALID_VALUE', async () => {
    const mem = new MemoryStore();
    expect(await codeOf(saveTemplate(mem, input({ layout: 'grid' as never })))).toBe('INVALID_VALUE');
    expect(mem.files.size).toBe(0);
  });
  it('text 항목과 style, inlineValue는 저장 후 재로드해도 유지된다', async () => {
    const mem = new MemoryStore();
    const sections = [{ id: 's', title: 't', inlineValue: '{공고명}', items: [{ kind: 'text' as const, id: 'k', label: 'L', text: '{공고명}까지', visible: true, style: { bold: true } }] }];
    await saveTemplate(mem, input({ layout: 'list', sections }));
    const t = (await listTemplates(mem)).templates[1]!;
    expect(t.layout).toBe('list');
    expect(t.sections[0]!.inlineValue).toBe('{공고명}');
    expect(t.sections[0]!.items[0]).toEqual({ kind: 'text', id: 'k', label: 'L', text: '{공고명}까지', visible: true, style: { bold: true } });
  });
  it('text 항목 text 누락과 알 수 없는 kind는 INVALID_VALUE', async () => {
    const mem = new MemoryStore();
    const mk = (it: unknown) => input({ sections: [{ id: 's', title: 't', items: [it as never] }] });
    expect(await codeOf(saveTemplate(mem, mk({ kind: 'text', id: 'k', label: 'L', visible: true })))).toBe('INVALID_VALUE');
    expect(await codeOf(saveTemplate(mem, mk({ kind: 'html', label: 'L', visible: true })))).toBe('INVALID_VALUE');
    expect(mem.files.size).toBe(0);
  });
  it('style이 모두 false면 저장하지 않는다', async () => {
    const mem = new MemoryStore();
    const items = [{ fieldKey: 'title' as const, label: 'x', visible: true, style: { bold: false, underline: false } }];
    await saveTemplate(mem, input({ sections: [{ id: 's', title: 't', items }] }));
    expect('style' in (await listTemplates(mem)).templates[1]!.sections[0]!.items[0]!).toBe(false);
  });
  it('옛 형식 파일은 layout table로 읽고 warning이 없다', async () => {
    const mem = new MemoryStore();
    const old = { id: 'o', name: '옛', isDefault: true, subject: '', greeting: '', closing: '', sections: [{ id: 's', title: 't', items: [{ fieldKey: 'title', label: '사업명', visible: true }] }], updatedAt: 'x' };
    await mem.writeText(CONFIG_PATHS.templates, JSON.stringify({ version: 1, items: [old] }));
    const snap = await listTemplates(mem);
    const t = snap.templates[0] as Template;
    expect(t.layout).toBe('table');
    expect(t.sections[0]!.items).toEqual([{ fieldKey: 'title', label: '사업명', visible: true }]);
    expect(snap.warnings).toEqual([]);
  });
  it('알 수 없는 kind 항목은 제거하고 warning 1개', async () => {
    const mem = new MemoryStore();
    const raw = { id: 'o', name: '옛', isDefault: true, subject: '', greeting: '', closing: '', sections: [{ id: 's', title: 't', items: [{ kind: 'html', label: 'x' }, { fieldKey: 'title', label: 'a', visible: true }] }], updatedAt: 'x' };
    await mem.writeText(CONFIG_PATHS.templates, JSON.stringify({ version: 1, items: [raw] }));
    const snap = await listTemplates(mem);
    expect(snap.templates[0]!.sections[0]!.items).toHaveLength(1);
    expect(snap.warnings).toHaveLength(1);
  });

  it('저장된 bid 템플릿만 있으면 내장 사전규격을 보충하되 bid 기본은 불변이고 파일은 쓰지 않는다', async () => {
    const mem = new MemoryStore();
    const raw = { id: 'b1', name: '입찰', isDefault: true, subject: '', greeting: '', closing: '', layout: 'table', sections: [], updatedAt: 'x' };
    await mem.writeText(CONFIG_PATHS.templates, JSON.stringify({ version: 1, items: [raw] }));
    const before = await mem.readText(CONFIG_PATHS.templates);
    const snap = await listTemplates(mem);
    expect(snap.templates.map((t) => [t.id, t.isDefault])).toEqual([['b1', true], [TEMPLATE_PRESPEC_DEFAULT_ID, true]]);
    expect(await mem.readText(CONFIG_PATHS.templates)).toBe(before);
  });
  it('isDefault는 종류별 첫 것만 유지하고, 기본이 없는 종류는 첫 항목이 기본', async () => {
    const mem = new MemoryStore();
    const mk = (id: string, isDefault: boolean, kind?: 'prespec') => ({ id, name: id, isDefault, subject: '', greeting: '', closing: '', layout: 'table', sections: [], updatedAt: 'x', ...(kind ? { kind } : {}) });
    await mem.writeText(CONFIG_PATHS.templates, JSON.stringify({ version: 1, items: [mk('b1', false), mk('b2', false), mk('p1', true, 'prespec'), mk('p2', true, 'prespec')] }));
    const snap = await listTemplates(mem);
    expect(snap.templates.map((t) => t.isDefault)).toEqual([true, false, true, false]);
  });
  it('새로 만들 때는 입력 kind를 쓰고, 수정 시에는 저장된 kind를 유지한다', async () => {
    const mem = new MemoryStore();
    const snap = await saveTemplate(mem, input({ kind: 'prespec' }));
    const created = snap.templates.find((t) => t.name === '내 템플릿')!;
    expect(created.kind).toBe('prespec');
    expect(created.isDefault).toBe(false);
    const edited = (await saveTemplate(mem, input({ id: created.id, name: '수정', kind: 'bid' }))).templates.find((t) => t.id === created.id)!;
    expect(edited.kind).toBe('prespec');
    const bidEdit = (await saveTemplate(mem, input({ id: TEMPLATE_DEFAULT_ID, kind: 'prespec' }))).templates.find((t) => t.id === TEMPLATE_DEFAULT_ID)!;
    expect(bidEdit.kind).toBeUndefined();
    expect(await codeOf(saveTemplate(mem, input({ kind: 'nope' as never })))).toBe('INVALID_VALUE');
    expect(await codeOf(saveTemplate(mem, input({ kind: 'orderplan' })))).toBe('INVALID_VALUE');
  });
  it('set-default는 같은 종류 안에서만 바꾼다', async () => {
    const mem = new MemoryStore();
    const created = (await saveTemplate(mem, input({ kind: 'prespec' }))).templates.find((t) => t.name === '내 템플릿')!;
    const snap = await setDefaultTemplate(mem, created.id);
    expect(snap.templates.map((t) => [t.id === created.id || t.id === TEMPLATE_DEFAULT_ID ? t.id === created.id ? 'new' : 'bid' : 'builtin-p', t.isDefault]))
      .toEqual([['bid', true], ['builtin-p', false], ['new', true]]);
  });
  it('종류별 LAST_TEMPLATE, 기본 삭제 시 같은 종류 첫 항목 승격', async () => {
    const mem = new MemoryStore();
    const created = (await saveTemplate(mem, input({ kind: 'prespec' }))).templates.find((t) => t.name === '내 템플릿')!;
    // bid는 1개뿐이라 사전규격이 여러 개여도 bid는 삭제 불가
    expect(await codeOf(deleteTemplate(mem, TEMPLATE_DEFAULT_ID))).toBe('LAST_TEMPLATE');
    const snap = await deleteTemplate(mem, TEMPLATE_PRESPEC_DEFAULT_ID);
    expect(snap.templates.map((t) => [t.id, t.isDefault])).toEqual([[TEMPLATE_DEFAULT_ID, true], [created.id, true]]);
  });
});
