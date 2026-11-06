import { missing, type FieldValue } from '../../core/types/common';
import type { NoticeKind, NoticeRef } from '../../core/types/notice';
import type { NoticeCodes, OpKind } from '../../core/types/org';
import { noticeId as makeNoticeId } from '../../core/model/ids';
import type { FieldMap } from '../../core/model/notice-fields';
import type { NewAttachment } from '../../engine/jobs/attachments';
import { fetchNotice, isCorrectionOf, listAttachments, mapApiItem, sourceUrlOf, type ApiItem, type FetchNoticeResult, type G2bContext } from './openapi';
import { fetchPrespec, listPrespecAttachments, mapPrespecItem } from './prespec-api';

export type FetchResult = FetchNoticeResult;

export interface NoticeSource {
  kind: NoticeKind;
  fetch(ref: NoticeRef, ctx: G2bContext): Promise<FetchResult>;
  idOf(ref: NoticeRef, item: ApiItem): string;
  refOf(ref: NoticeRef, item: ApiItem): NoticeRef;
  mapFields(item: ApiItem, fetchedAt: string): FieldMap;
  attachments(item: ApiItem): NewAttachment[];
  sourceUrl(item: ApiItem, ref: NoticeRef, fetchedAt: string): FieldValue<string>;
  isCorrection(item: ApiItem): boolean;
  /** 연계 사전규격 등록번호. 없으면 null. bid만 구현한다. */
  linkedPrespecNo?(item: ApiItem): string | null;
  /** 재공고 검색용 기관 코드. 전부 없으면 undefined. bid만 구현한다. */
  codesOf?(item: ApiItem, operation: string): NoticeCodes | undefined;
  /** 원 공고 noticeNo. 재공고가 아니면 null. bid만 구현한다. */
  reannounceOf?(item: ApiItem): string | null;
  extract: boolean;
  acceptsHtml: boolean;
}

export const bidSource: NoticeSource = {
  kind: 'bid',
  fetch: (ref, ctx) => fetchNotice(ref.noticeNo, ref.round, ctx),
  idOf: (ref, item) => makeNoticeId(item.bidNtceNo ?? ref.noticeNo, item.bidNtceOrd),
  refOf: (ref, item) => ({ ...ref, noticeNo: item.bidNtceNo ?? ref.noticeNo, round: item.bidNtceOrd, origin: ref.origin }),
  mapFields: mapApiItem,
  attachments: listAttachments,
  sourceUrl: (item, _ref, fetchedAt) => sourceUrlOf(item, fetchedAt),
  isCorrection: isCorrectionOf,
  linkedPrespecNo: (item) => (item.bfSpecRgstNo ?? '').trim() || null,
  codesOf: (item, operation) => {
    const opKind = /(Servc|Thng|Cnstwk|Frgcpt)/.exec(operation)?.[1] as OpKind | undefined;
    const c: NoticeCodes = {
      ...((item.dminsttCd ?? '').trim() ? { demandOrgCode: item.dminsttCd!.trim() } : {}),
      ...((item.ntceInsttCd ?? '').trim() ? { orderingOrgCode: item.ntceInsttCd!.trim() } : {}),
      ...((item.pubPrcrmntClsfcNo ?? '').trim() ? { clsfcNo: item.pubPrcrmntClsfcNo!.trim() } : {}),
      ...(opKind ? { opKind } : {}),
    };
    return Object.keys(c).length > 0 ? c : undefined;
  },
  reannounceOf: (item) => ((item.reNtceYn ?? '').trim().toUpperCase() === 'Y' && (item.befBidBbancNo ?? '').trim() !== '' ? item.befBidBbancNo!.trim() : null),
  extract: true,
  acceptsHtml: true,
};

export const prespecSource: NoticeSource = {
  kind: 'prespec',
  fetch: (ref, ctx) => fetchPrespec(ref.noticeNo, ctx),
  idOf: (ref) => ref.noticeNo,
  refOf: (ref) => ({ ...ref, kind: 'prespec' }),
  mapFields: mapPrespecItem,
  attachments: listPrespecAttachments,
  sourceUrl: (_item, ref, fetchedAt) =>
    ref.detailUrl ? { value: ref.detailUrl, raw: ref.detailUrl, status: 'verified', source: { kind: 'derived', ref: 'detailUrl', fetchedAt } } : missing(),
  isCorrection: () => false,
  extract: false,
  acceptsHtml: false,
};

/** code 속성을 가져 collect-job toError가 KIND_UNSUPPORTED로 변환한다. */
export class KindUnsupportedError extends Error {
  code = 'KIND_UNSUPPORTED';
  constructor(kind: NoticeKind) { super(`지원하지 않는 공고 종류입니다: ${kind}`); }
}

/** orderplan이면 KIND_UNSUPPORTED를 던진다. */
export function sourceFor(kind: NoticeKind): NoticeSource {
  if (kind === 'bid') return bidSource;
  if (kind === 'prespec') return prespecSource;
  throw new KindUnsupportedError(kind);
}
