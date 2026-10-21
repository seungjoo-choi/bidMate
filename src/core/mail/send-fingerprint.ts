/** [바로 발송] 미리보기와 잡이 같은 메일인지 비교하는 지문. 순서·대소문자·공백 차이는 무시한다. */
export interface SendFingerprintInput {
  to: string[]; cc: string[]; subject: string;
  attachments: Array<{ name: string; size: number }>;
  /** 본문 html. 미리보기에서 본 본문과 다른 본문이 나가지 않게 한다 */
  body: string;
}

const addrs = (a: string[]): string[] => a.map((x) => x.trim().toLowerCase()).sort();

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function sendFingerprint(d: SendFingerprintInput): string {
  const atts = d.attachments.map((a) => `${a.name}\u0000${a.size}`).sort();
  return djb2(JSON.stringify({ to: addrs(d.to), cc: addrs(d.cc), subject: d.subject.trim(), attachments: atts, body: djb2(d.body) }));
}

/** 초안 기준 지문. 미리보기(대시보드)와 잡이 같은 함수를 쓴다. 첨부 이름은 잡이 올리는 저장 파일명(path basename). */
export function draftFingerprint(d: { to: string[]; cc: string[]; subject: string; html: string; attachments: Array<{ path: string; size: number }> }): string {
  return sendFingerprint({
    to: d.to, cc: d.cc, subject: d.subject, body: d.html,
    attachments: d.attachments.map((a) => ({ name: a.path.slice(a.path.lastIndexOf('/') + 1), size: a.size })),
  });
}
