import { sanitizeSegment } from '../../core/model/sanitize';
import type { RfpDocRef } from '../../core/types/rfp';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

export const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export const RFP_UPLOADS_DIR = 'rfp/uploads';
export const RFP_COMPARES_DIR = 'rfp/compares';
const ID_RE = /^[uc]_\d{14}_[a-z0-9]{4}$/;

/** 경로에 쓰기 전 id 형식을 검증한다. prefix가 다르면(u/c 혼용) 거부한다. */
export function assertId(id: unknown, prefix: 'u' | 'c'): string {
  if (typeof id !== 'string' || !ID_RE.test(id) || id[0] !== prefix) throw err('BAD_REQUEST', '잘못된 식별자입니다.');
  return id;
}

/** `u_YYYYMMDDHHMMSS_xxxx` / `c_...` (UTC 기준) */
export function newId(prefix: 'u' | 'c', now: Date): string {
  const ts = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${ts}_${s}`;
}

export const uploadDir = (uploadId: string): string => `${RFP_UPLOADS_DIR}/${assertId(uploadId, 'u')}`;
export const uploadSourcePath = (uploadId: string, ext: string): string => `${uploadDir(uploadId)}/source.${ext}`;
export const uploadSetPath = (uploadId: string): string => `${uploadDir(uploadId)}/requirements.json`;
export const uploadTextPath = (uploadId: string): string => `${uploadDir(uploadId)}/text.txt`;
export const uploadMetaPath = (uploadId: string): string => `${uploadDir(uploadId)}/meta.json`;
export const comparePath = (compareId: string): string => `${RFP_COMPARES_DIR}/${assertId(compareId, 'c')}.json`;

/** 수집 공고 문서의 캐시 이름. zip 내부 문서는 마지막 파일명을 붙인다. */
export function noticeCacheName(ref: Extract<RfpDocRef, { kind: 'notice' }>): string {
  const base = sanitizeSegment(ref.attachmentId, 80);
  if (ref.innerPath === undefined) return base;
  const last = ref.innerPath.split('/').pop() ?? ref.innerPath;
  return `${base}__${sanitizeSegment(last, 40)}_${hash8(ref.innerPath)}`;
}

/** FNV-1a 32비트 해시(16진 8자리). innerPath 전체로 캐시 이름이 겹치지 않게 한다. */
export function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
export const noticeJsonPath = (folder: string, ref: Extract<RfpDocRef, { kind: 'notice' }>): string => `${folder}/rfp/${noticeCacheName(ref)}.json`;
export const noticeTextPath = (folder: string, ref: Extract<RfpDocRef, { kind: 'notice' }>): string => `${folder}/rfp/${noticeCacheName(ref)}.txt`;

/** 없거나 손상이면 null. */
export async function readJsonOrNull<T>(store: IFileStore, path: string): Promise<T | null> {
  try { return await readJson<T>(store, path); } catch { return null; }
}

export { readJson, writeJson };
