import type { RenderedMail, ResolvedValue, UnresolvedVar } from '../types/mail';
import type { Notice } from '../types/notice';
import type { Template, TemplateFieldKey, TemplateStyle } from '../types/template';
import { escapeHtml } from './escape';
import { resolveValue } from './values';
import { isTemplateFieldKey, VARIABLE_BY_KEY, VARIABLE_BY_NAME } from './variables';

export type { RenderedMail, UnresolvedVar };

const VAR_RE = /\{([가-힣A-Za-z0-9_.]+)\}/g;
const SUBJECT_MAX = 300;

interface Ctx { notice: Notice; now: Date; unresolved: UnresolvedVar[]; unknownVars: string[] }

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
    const rv = resolveValue(ctx.notice, fieldKey, ctx.now);
    if (rv.status !== 'ok') pushUnresolved(ctx, { name, label: def?.label ?? name, status: rv.status, where });
    return rv.text;
  });
}

const textToHtml = (s: string) => escapeHtml(s).replace(/\r?\n/g, '<br>');

const TABLE_STYLE = 'border-collapse:collapse;margin:0 0 12px 0;';
const TH_STYLE = 'padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;';
const TD_STYLE = 'padding:4px 0;vertical-align:top;';

const LIST_ITEM_STYLE = 'padding-left:1.5em;';

/** 값 강조. bold면 strong, underline이면 u, 둘 다면 strong 안에 u. */
function styleWrap(html: string, style: TemplateStyle | undefined): string {
  let out = html;
  if (style?.underline) out = `<u>${out}</u>`;
  if (style?.bold) out = `<strong>${out}</strong>`;
  return out;
}

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

/** opts.now는 {오늘}에 쓰는 시각. 주지 않으면 지금 시각. */
export function renderMail(template: Template, notice: Notice, opts: { now?: Date } = {}): RenderedMail {
  const now = opts.now ?? new Date();
  const ctx: Ctx = { notice, now, unresolved: [], unknownVars: [] };

  const subject = substitute(template.subject, 'subject', ctx).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, SUBJECT_MAX);
  const greeting = substitute(template.greeting, 'greeting', ctx);
  const closing = substitute(template.closing, 'closing', ctx);

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  if (greeting) {
    htmlParts.push(`<p>${textToHtml(greeting)}</p>`);
    textParts.push(greeting);
  }

  const isList = template.layout === 'list';
  const listLines: string[] = [];
  let no = 0;
  for (const section of template.sections) {
    if (section.plain) {
      const body = substitute(section.title, section.id, ctx);
      if (body.trim() === '') continue;
      if (isList) {
        htmlParts.push(`<div style="margin:0 0 8px 0;">${textToHtml(body)}</div>`);
        listLines.push(body);
      } else {
        htmlParts.push(`<p>${textToHtml(body)}</p>`);
        textParts.push(body);
      }
      continue;
    }
    const items = section.items.filter((it) => it.visible);
    const hasInline = (section.inlineValue ?? '').trim() !== '';
    if (items.length === 0 && !hasInline) continue;
    no += 1;
    const title = substitute(section.title, section.id, ctx);
    const inline = hasInline ? substitute(section.inlineValue!, section.id, ctx) : '';
    const head = hasInline ? `${no}. ${title} : ${inline}` : `${no}. ${title}`;
    const rows: string[] = [];
    const lines: string[] = [head];
    const divs: string[] = [hasInline
      ? `<div><strong>${no}. ${escapeHtml(title)}</strong> : ${textToHtml(inline)}</div>`
      : `<div><strong>${no}. ${escapeHtml(title)}</strong></div>`];
    let i = 0;
    for (const it of items) {
      i += 1;
      const label = substitute(it.label, section.id, ctx);
      let vHtml: string;
      let vText: string;
      let attach: string[] | null = null;
      if (it.kind === 'text') {
        vText = substitute(it.text, section.id, ctx);
        vHtml = textToHtml(vText);
      } else {
        const rv = resolveValue(notice, it.fieldKey, now);
        if (rv.status !== 'ok') {
          const def = VARIABLE_BY_KEY.get(it.fieldKey);
          pushUnresolved(ctx, { name: def?.name ?? it.fieldKey, label: it.label, status: rv.status, where: section.id });
        }
        vText = rv.text;
        vHtml = valueHtml(it.fieldKey, rv);
        if (it.fieldKey === 'attachmentList' && Array.isArray(rv.raw) && rv.raw.length > 0) attach = rv.raw as string[];
      }
      vHtml = styleWrap(vHtml, it.style);
      if (isList) {
        if (attach) {
          divs.push(`<div style="${LIST_ITEM_STYLE}">${i}) ${escapeHtml(label)} :${vHtml}</div>`);
          lines.push(`  ${i}) ${label} :`);
          for (const l of attach) lines.push(`    - ${l}`);
        } else {
          divs.push(`<div style="${LIST_ITEM_STYLE}">${i}) ${label ? `${escapeHtml(label)} : ` : ''}${vHtml}</div>`);
          lines.push(label ? `  ${i}) ${label} : ${vText}` : `  ${i}) ${vText}`);
        }
      } else {
        rows.push(`<tr><th align="left" style="${TH_STYLE}">${escapeHtml(label)}</th><td style="${TD_STYLE}">${vHtml}</td></tr>`);
        if (attach) {
          lines.push(`- ${label}:`);
          for (const l of attach) lines.push(`  - ${l}`);
        } else {
          lines.push(`- ${label}: ${vText}`);
        }
      }
    }
    if (isList) {
      htmlParts.push(`<div style="margin:0 0 8px 0;">${divs.join('')}</div>`);
      listLines.push(...lines);
    } else {
      const h3 = `<h3>${no}. ${escapeHtml(title)}${hasInline ? ` : ${textToHtml(inline)}` : ''}</h3>`;
      htmlParts.push(rows.length > 0 ? `${h3}<table style="${TABLE_STYLE}">${rows.join('')}</table>` : h3);
      textParts.push(lines.join('\n'));
    }
  }
  if (listLines.length > 0) textParts.push(listLines.join('\n'));

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
