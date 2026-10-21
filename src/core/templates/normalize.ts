import { newId } from '../model/ids';
import type { NoticeKind } from '../types/notice';
import type { Template, TemplateItem, TemplateSection, TemplateStyle } from '../types/template';
import { VARIABLE_BY_KEY, isTemplateFieldKey } from './variables';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isKind = (x: unknown): x is NoticeKind => x === 'bid' || x === 'prespec' || x === 'orderplan';
const LEGACY_CRED_TEXT = '경영상태(신용평가등급) 평가({경영상태}), 대외신인도({대외신인도})';
const LEGACY_PERF_TEXT = '{실적인정기간} 이내 국내외 유사사업 수행실적({실적평가}) - {실적인정금액} 이상인 사업에 한함';
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
        // 옛 기본 템플릿의 대외신인도 문구는 합성 항목으로 승격한다(문구를 고친 항목은 유지).
        if (it.id === 'txt_cred' && it.text === LEGACY_CRED_TEXT) {
          items.push({
            fieldKey: 'credibilityEval', label: str(it.label), visible: typeof it.visible === 'boolean' ? it.visible : true,
            ...(style ? { style } : {}),
          });
          continue;
        }
        if (it.id === 'txt_perf' && it.text === LEGACY_PERF_TEXT) {
          items.push({
            fieldKey: 'performanceEval', label: str(it.label), visible: typeof it.visible === 'boolean' ? it.visible : true,
            ...(style ? { style } : {}),
          });
          continue;
        }
        items.push({
          kind: 'text', id: typeof it.id === 'string' && it.id ? it.id : newId('txt'),
          label: str(it.label), text: str(it.text), visible: typeof it.visible === 'boolean' ? it.visible : true,
          ...(style ? { style } : {}),
          ...(isTemplateFieldKey(it.fromFieldKey) ? { fromFieldKey: it.fromFieldKey } : {}),
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
        fieldKey: it.fieldKey === 'evalMethod' && it.label === '평가방법' ? 'evalMethodText' : it.fieldKey,
        label: typeof it.label === 'string' ? it.label : (VARIABLE_BY_KEY.get(it.fieldKey)?.label ?? it.fieldKey),
        visible: typeof it.visible === 'boolean' ? it.visible : true,
        ...(style ? { style } : {}),
      });
    }
    const inlineValue = typeof s.inlineValue === 'string' && s.inlineValue ? s.inlineValue : undefined;
    sections.push({ id: typeof s.id === 'string' && s.id ? s.id : newId('sec'), title: str(s.title), ...(inlineValue ? { inlineValue } : {}), items, ...(s.plain === true ? { plain: true } : {}) });
  }
  const template: Template = {
    id, name, isDefault: r.isDefault === true,
    subject: str(r.subject), greeting: str(r.greeting), closing: str(r.closing),
    layout: r.layout === 'list' ? 'list' : 'table',
    ...(isKind(r.kind) && r.kind !== 'bid' ? { kind: r.kind } : {}),
    sections,
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : now.toISOString(),
  };
  return { template, warnings };
}
