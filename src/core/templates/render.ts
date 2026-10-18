import type { RenderedMail, ResolvedValue, UnresolvedVar } from '../types/mail';
import type { Notice } from '../types/notice';
import type { Template, TemplateFieldKey } from '../types/template';
import { escapeHtml } from './escape';
import { resolveValue } from './values';
import { isTemplateFieldKey, VARIABLE_BY_KEY, VARIABLE_BY_NAME } from './variables';

export type { RenderedMail, UnresolvedVar };

const VAR_RE = /\{([가-힣A-Za-z0-9_.]+)\}/g;
const SUBJECT_MAX = 300;

interface Ctx { notice: Notice; unresolved: UnresolvedVar[]; unknownVars: string[] }

function pushUnresolved(ctx: Ctx, u: UnresolvedVar): void {
  if (!ctx.unresolved.some((x) => x.name === u.name && x.where === u.where)) ctx.unresolved.push(u);
}

/** {변수}를 평문 값으로 치환한다. 알 수 없는 이름은 원문 유지. */
function substitute(src: string, where: string, ctx: Ctx): string {
  return src.replace(VAR_RE, (whole, name: string) => {
    const def = VARIABLE_BY_NAME.get(name);
    // {custom.키}는 레지스트리에 없고 접두사로 사용자 정의 필드를 읽는다.
    const fieldKey = def?.fieldKey ?? (name.startsWith('custom.') && isTemplateFieldKey(name) ? name : undefined);
    if (!fieldKey) {
      if (!ctx.unknownVars.includes(name)) ctx.unknownVars.push(name);
      return whole;
    }
    const rv = resolveValue(ctx.notice, fieldKey);
    if (rv.status !== 'ok') pushUnresolved(ctx, { name, label: def?.label ?? name, status: rv.status, where });
    return rv.text;
  });
}

const textToHtml = (s: string) => escapeHtml(s).replace(/\r?\n/g, '<br>');

const TABLE_STYLE = 'border-collapse:collapse;margin:0 0 12px 0;';
const TH_STYLE = 'padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;';
const TD_STYLE = 'padding:4px 0;vertical-align:top;';

function valueHtml(fieldKey: TemplateFieldKey, rv: ResolvedValue): string {
  if (fieldKey === 'attachmentList' && Array.isArray(rv.raw) && rv.raw.length > 0) {
    return `<ul style="margin:0;padding-left:18px;">${(rv.raw as string[]).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
  }
  if (fieldKey === 'sourceUrl' && rv.status === 'ok' && /^https?:\/\//.test(rv.text)) {
    const e = escapeHtml(rv.text);
    return `<a href="${e}">${e}</a>`;
  }
  return textToHtml(rv.text);
}

export function renderMail(template: Template, notice: Notice): RenderedMail {
  const ctx: Ctx = { notice, unresolved: [], unknownVars: [] };

  const subject = substitute(template.subject, 'subject', ctx).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, SUBJECT_MAX);
  const greeting = substitute(template.greeting, 'greeting', ctx);
  const closing = substitute(template.closing, 'closing', ctx);

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  if (greeting) {
    htmlParts.push(`<p>${textToHtml(greeting)}</p>`);
    textParts.push(greeting);
  }

  let no = 0;
  for (const section of template.sections) {
    const items = section.items.filter((it) => it.visible);
    if (items.length === 0) continue;
    no += 1;
    const rows: string[] = [];
    const lines: string[] = [`${no}. ${section.title}`];
    for (const it of items) {
      const rv = resolveValue(notice, it.fieldKey);
      if (rv.status !== 'ok') {
        const def = VARIABLE_BY_KEY.get(it.fieldKey);
        pushUnresolved(ctx, { name: def?.name ?? it.fieldKey, label: it.label, status: rv.status, where: section.id });
      }
      rows.push(`<tr><th align="left" style="${TH_STYLE}">${escapeHtml(it.label)}</th><td style="${TD_STYLE}">${valueHtml(it.fieldKey, rv)}</td></tr>`);
      if (it.fieldKey === 'attachmentList' && Array.isArray(rv.raw) && rv.raw.length > 0) {
        lines.push(`- ${it.label}:`);
        for (const l of rv.raw as string[]) lines.push(`  - ${l}`);
      } else {
        lines.push(`- ${it.label}: ${rv.text}`);
      }
    }
    htmlParts.push(`<h3>${no}. ${escapeHtml(section.title)}</h3><table style="${TABLE_STYLE}">${rows.join('')}</table>`);
    textParts.push(lines.join('\n'));
  }

  if (closing) {
    htmlParts.push(`<p>${textToHtml(closing)}</p>`);
    textParts.push(closing);
  }

  return {
    subject,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;">${htmlParts.join('')}</div>`,
    text: textParts.join('\n\n'),
    unresolved: ctx.unresolved,
    unknownVars: ctx.unknownVars,
  };
}
