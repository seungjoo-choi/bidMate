import { newId } from '../model/ids';
import type { Template, TemplateItem, TemplateSection, TemplateStyle } from '../types/template';
import { VARIABLE_BY_KEY, isTemplateFieldKey } from './variables';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** bold/underline이 true인 키만 남긴다. 둘 다 아니면 undefined(style 속성 생략). */
export function normalizeStyle(x: unknown): TemplateStyle | undefined {
  if (!isObj(x)) return undefined;
  const bold = x.bold === true;
  const underline = x.underline === true;
  if (!bold && !underline) return undefined;
  return { ...(bold ? { bold: true } : {}), ...(underline ? { underline: true } : {}) };
}

/** 저장된 원본을 Template으로 보정한다(메모리만). 알 수 없는 fieldKey 항목은 제거하고 warning. */
export function normalizeTemplate(raw: unknown, now: Date): { template: Template; warnings: string[] } {
  const r = isObj(raw) ? raw : {};
  const warnings: string[] = [];
  const id = typeof r.id === 'string' && r.id ? r.id : newId('tpl');
  const name = typeof r.name === 'string' && r.name ? r.name : '(이름 없음)';
  const sections: TemplateSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (!isObj(s)) continue;
    const items: TemplateItem[] = [];
    for (const it of Array.isArray(s.items) ? s.items : []) {
      if (!isObj(it)) continue;
      const style = normalizeStyle(it.style);
      if (it.kind === 'text') {
        items.push({
          kind: 'text', id: typeof it.id === 'string' && it.id ? it.id : newId('txt'),
          label: str(it.label), text: str(it.text), visible: typeof it.visible === 'boolean' ? it.visible : true,
          ...(style ? { style } : {}),
        });
        continue;
      }
      if (it.kind !== undefined && it.kind !== 'field') {
        warnings.push(`템플릿 "${name}": 알 수 없는 항목 종류 "${String(it.kind)}"을 제거했습니다`);
        continue;
      }
      if (!isTemplateFieldKey(it.fieldKey)) {
        warnings.push(`템플릿 "${name}": 알 수 없는 항목 "${String(it.fieldKey)}"을 제거했습니다`);
        continue;
      }
      items.push({
        fieldKey: it.fieldKey,
        label: typeof it.label === 'string' ? it.label : (VARIABLE_BY_KEY.get(it.fieldKey)?.label ?? it.fieldKey),
        visible: typeof it.visible === 'boolean' ? it.visible : true,
        ...(style ? { style } : {}),
      });
    }
    const inlineValue = typeof s.inlineValue === 'string' && s.inlineValue ? s.inlineValue : undefined;
    sections.push({ id: typeof s.id === 'string' && s.id ? s.id : newId('sec'), title: str(s.title), ...(inlineValue ? { inlineValue } : {}), items });
  }
  const template: Template = {
    id, name, isDefault: r.isDefault === true,
    subject: str(r.subject), greeting: str(r.greeting), closing: str(r.closing),
    layout: r.layout === 'list' ? 'list' : 'table',
    sections,
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : now.toISOString(),
  };
  return { template, warnings };
}
