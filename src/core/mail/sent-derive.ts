import type { ComposeRecord, SendRecord, SentIndexEntry } from '../types/compose';
import type { IndexEntry } from '../types/index-file';
import type { MailDraft } from '../types/mail';
import type { Notice } from '../types/notice';

const valid = (records: SendRecord[]): SendRecord[] => records.filter((r) => !r.voidedAt);

/**
 * 발송 기록에서 notice.mail을 다시 계산한다.
 * 유효(취소 안 된) 기록이 있으면 delivered + 최신 sentAt + 개수. 없으면 deliveredAt/sentCount를 지우고,
 * prev가 delivered였을 때만 초안 유무로 drafting/none을 정한다(그 밖에는 prev.status 유지).
 */
export function deriveMailStatus(records: SendRecord[], hasDraft: boolean, prev: Notice['mail']): Notice['mail'] {
  const ok = valid(records);
  if (ok.length > 0) {
    const deliveredAt = ok.map((r) => r.sentAt).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
    return { ...prev, status: 'delivered', deliveredAt, sentCount: ok.length };
  }
  const { deliveredAt: _d, sentCount: _c, ...rest } = prev;
  return { ...rest, status: prev.status === 'delivered' ? (hasDraft ? 'drafting' : 'none') : prev.status };
}

/** 옛 delivered 공고(mail-sent.json 없음)용 가상 기록. 해당하지 않으면 null. */
export function legacyRecord(notice: Notice): SendRecord | null {
  const at = notice.mail.deliveredAt;
  if (notice.mail.status !== 'delivered' || !at) return null;
  return {
    id: `legacy-${notice.id}`, noticeId: notice.id, sentAt: at, recordedAt: at, source: 'manual',
    summary: { subject: '', toCount: 0, ccCount: 0, attachmentCount: 0 },
  };
}

/** 마지막 유효 발송보다 뒤에 작성된 최신 ComposeRecord. 없으면 null. */
export function attributeCompose(records: SendRecord[], composes: ComposeRecord[]): ComposeRecord | null {
  const last = valid(records).reduce((m, r) => Math.max(m, Date.parse(r.sentAt)), -Infinity);
  let best: ComposeRecord | null = null;
  for (const c of composes) {
    const t = Date.parse(c.composedAt);
    if (!(t > last)) continue;
    if (!best || t > Date.parse(best.composedAt)) best = c;
  }
  return best;
}

export function summaryOf(c: ComposeRecord | null, d: MailDraft | null): SendRecord['summary'] {
  if (c) return { subject: c.snapshot.subject, toCount: c.snapshot.to.length, ccCount: c.snapshot.cc.length, attachmentCount: c.attachments.length };
  if (d) return { subject: d.subject, toCount: d.to.length, ccCount: d.cc.length, attachmentCount: d.attachments.length };
  return { subject: '', toCount: 0, ccCount: 0, attachmentCount: 0 };
}

export function sentIndexEntryOf(r: SendRecord, e: IndexEntry): SentIndexEntry {
  return {
    id: r.id, noticeId: r.noticeId, ...(e.kind ? { kind: e.kind } : {}),
    noticeNo: e.noticeNo, round: e.round, title: e.title, orderingOrg: e.orderingOrg, folder: e.folder,
    sentAt: r.sentAt, source: r.source, ...(r.provider ? { provider: r.provider } : {}),
    ...(r.signal ? { confirmed: r.signal.confirmed, signalKind: r.signal.kind } : {}),
    subject: r.summary.subject, toCount: r.summary.toCount, ccCount: r.summary.ccCount, attachmentCount: r.summary.attachmentCount,
    ...(r.composeRecordId ? { composeRecordId: r.composeRecordId } : {}),
    ...(r.voidedAt ? { voidedAt: r.voidedAt } : {}),
  };
}
