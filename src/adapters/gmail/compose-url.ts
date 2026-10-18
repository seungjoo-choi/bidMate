export const GMAIL_URL_MAX = 8000;

export interface GmailComposeInput { accountIndex: number; to: string[]; cc: string[]; subject: string; bodyText: string }

const enc = (v: string) => encodeURIComponent(v.replace(/\r\n/g, '\n'));

function recipients(list: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join(',');
}

/** Gmail 작성 창 주소를 만든다. 한도를 넘으면 본문을 통째로 뺀다(절단 금지). */
export function buildGmailComposeUrl(i: GmailComposeInput, maxLength = GMAIL_URL_MAX): { url: string; bodyIncluded: boolean } {
  const n = Number.isInteger(i.accountIndex) && i.accountIndex >= 0 ? i.accountIndex : 0;
  let url = `https://mail.google.com/mail/u/${n}/?fs=1&tf=cm`;
  const to = recipients(i.to);
  const cc = recipients(i.cc);
  if (to) url += `&to=${enc(to)}`;
  if (cc) url += `&cc=${enc(cc)}`;
  if (i.subject) url += `&su=${enc(i.subject)}`;
  if (!i.bodyText) return { url, bodyIncluded: false };
  const withBody = `${url}&body=${enc(i.bodyText)}`;
  if (withBody.length > maxLength) return { url, bodyIncluded: false };
  return { url: withBody, bodyIncluded: true };
}
