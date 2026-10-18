import { newId } from '../../core/model/ids';
import { builtinDefaultTemplate } from '../../core/templates/default-template';
import { normalizeStyle, normalizeTemplate } from '../../core/templates/normalize';
import { isTemplateFieldKey } from '../../core/templates/variables';
import type { TemplateInput, TemplatesSnapshot } from '../../core/types/config-file';
import type { Template, TemplateItem, TemplateLayout, TemplateSection } from '../../core/types/template';
import type { IFileStore } from '../file-store/types';
import { loadList, saveList, withConfigLock } from './config-store';
import type { ConfigOpts } from './recipients-api';


const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const nowOf = (opts: ConfigOpts): Date => (opts.now ?? (() => new Date()))();

/** 파일 없음(또는 빈 목록)이면 내장 기본 1개. isDefault는 하나만, 없으면 첫 항목이 기본. */
async function loadTemplates(store: IFileStore, now: Date): Promise<TemplatesSnapshot> {
  const r = await loadList<Template>(store, 'templates', (raw) => {
    const n = normalizeTemplate(raw, now);
    return { item: n.template, warnings: n.warnings };
  }, now);
  if (r.items.length === 0) return { templates: [builtinDefaultTemplate(now)], warnings: r.warnings };
  let found = false;
  const items = r.items.map((t) => {
    if (t.isDefault && !found) { found = true; return t; }
    return t.isDefault ? { ...t, isDefault: false } : t;
  });
  if (!found) items[0] = { ...items[0]!, isDefault: true };
  return { templates: items, warnings: r.warnings };
}

export const listTemplates = (store: IFileStore, opts: ConfigOpts = {}): Promise<TemplatesSnapshot> => loadTemplates(store, nowOf(opts));

function validateStyle(x: unknown) {
  if (x === undefined) return undefined;
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw err('INVALID_VALUE', '항목 style 형식이 올바르지 않습니다.');
  const { bold, underline } = x as { bold?: unknown; underline?: unknown };
  if ((bold !== undefined && typeof bold !== 'boolean') || (underline !== undefined && typeof underline !== 'boolean')) {
    throw err('INVALID_VALUE', '항목 style 값이 올바르지 않습니다.');
  }
  return normalizeStyle(x);
}

function validateInput(input: TemplateInput): { name: string; layout: TemplateLayout; sections: TemplateSection[] } {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 100) throw err('INVALID_VALUE', '템플릿 이름은 1자 이상 100자 이하여야 합니다.');
  for (const k of ['subject', 'greeting', 'closing'] as const) {
    if (typeof input[k] !== 'string') throw err('INVALID_VALUE', `${k}은(는) 문자열이어야 합니다.`);
  }
  if (input.layout !== 'table' && input.layout !== 'list') throw err('INVALID_VALUE', 'layout은 table 또는 list여야 합니다.');
  if (!Array.isArray(input.sections)) throw err('INVALID_VALUE', 'sections는 배열이어야 합니다.');
  const sections = input.sections.map((s): TemplateSection => {
    if (typeof s !== 'object' || s === null || typeof s.title !== 'string' || !Array.isArray(s.items)) throw err('INVALID_VALUE', '섹션 형식이 올바르지 않습니다.');
    if (s.inlineValue !== undefined && typeof s.inlineValue !== 'string') throw err('INVALID_VALUE', 'inlineValue는 문자열이어야 합니다.');
    return {
      id: typeof s.id === 'string' && s.id ? s.id : newId('sec'),
      title: s.title,
      ...(s.inlineValue ? { inlineValue: s.inlineValue } : {}),
      items: s.items.map((it): TemplateItem => {
        if (typeof it !== 'object' || it === null) throw err('INVALID_VALUE', '항목 형식이 올바르지 않습니다.');
        const kind = (it as { kind?: unknown }).kind;
        const style = validateStyle((it as { style?: unknown }).style);
        if (kind === 'text') {
          const t = it as { id?: unknown; label?: unknown; text?: unknown; visible?: unknown };
          if (typeof t.label !== 'string' || typeof t.text !== 'string' || typeof t.visible !== 'boolean') throw err('INVALID_VALUE', '문구 항목 형식이 올바르지 않습니다.');
          return {
            kind: 'text', id: typeof t.id === 'string' && t.id ? t.id : newId('txt'),
            label: t.label, text: t.text, visible: t.visible, ...(style ? { style } : {}),
          };
        }
        if (kind !== undefined && kind !== 'field') throw err('INVALID_VALUE', `알 수 없는 항목 종류: ${String(kind)}`);
        const f = it as { fieldKey?: unknown; label?: unknown; visible?: unknown };
        if (!isTemplateFieldKey(f.fieldKey)) throw err('INVALID_VALUE', `알 수 없는 항목: ${String(f.fieldKey)}`);
        if (typeof f.label !== 'string' || typeof f.visible !== 'boolean') throw err('INVALID_VALUE', '항목 형식이 올바르지 않습니다.');
        return { fieldKey: f.fieldKey, label: f.label, visible: f.visible, ...(style ? { style } : {}) };
      }),
    };
  });
  return { name, layout: input.layout, sections };
}

export function saveTemplate(store: IFileStore, input: TemplateInput, opts: ConfigOpts = {}): Promise<TemplatesSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const { name, layout, sections } = validateInput(input);
    const snap = await loadTemplates(store, now);
    const list = snap.templates;
    const idx = input.id ? list.findIndex((t) => t.id === input.id) : -1;
    if (input.id && idx < 0) throw err('NOT_FOUND', '템플릿을 찾을 수 없습니다.');
    const t: Template = {
      id: idx >= 0 ? list[idx]!.id : newId('tpl'), name, isDefault: idx >= 0 ? list[idx]!.isDefault : false,
      subject: input.subject, greeting: input.greeting, closing: input.closing, layout, sections, updatedAt: now.toISOString(),
    };
    if (idx >= 0) list[idx] = t;
    else list.push(t);
    await saveList(store, 'templates', list, now);
    return { templates: list, warnings: snap.warnings };
  });
}

export function deleteTemplate(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<TemplatesSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const snap = await loadTemplates(store, now);
    const target = snap.templates.find((t) => t.id === id);
    if (!target) throw err('NOT_FOUND', '템플릿을 찾을 수 없습니다.');
    if (snap.templates.length <= 1) throw err('LAST_TEMPLATE', '마지막 템플릿은 삭제할 수 없습니다.');
    const rest = snap.templates.filter((t) => t.id !== id);
    // 기본을 지우면 남은 첫 항목이 기본
    if (target.isDefault) rest[0] = { ...rest[0]!, isDefault: true, updatedAt: now.toISOString() };
    await saveList(store, 'templates', rest, now);
    return { templates: rest, warnings: snap.warnings };
  });
}

export function setDefaultTemplate(store: IFileStore, id: string, opts: ConfigOpts = {}): Promise<TemplatesSnapshot> {
  return withConfigLock(store, async () => {
    const now = nowOf(opts);
    const snap = await loadTemplates(store, now);
    if (!snap.templates.some((t) => t.id === id)) throw err('NOT_FOUND', '템플릿을 찾을 수 없습니다.');
    const list = snap.templates.map((t) => {
      const want = t.id === id;
      return t.isDefault === want ? t : { ...t, isDefault: want, updatedAt: now.toISOString() };
    });
    await saveList(store, 'templates', list, now);
    return { templates: list, warnings: snap.warnings };
  });
}
