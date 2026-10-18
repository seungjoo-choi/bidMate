export type ISODate = string;
export type FieldStatus = 'verified' | 'needs_review' | 'missing' | 'user_edited';
export type SourceKind = 'api' | 'html' | 'document' | 'user' | 'derived';
export interface FieldSource { kind: SourceKind; ref: string; evidence?: string; page?: number; fetchedAt: ISODate; }
export interface FieldValue<T> {
  value: T | null; raw?: string; status: FieldStatus; source?: FieldSource;
  candidates?: Array<{ value: T; source: FieldSource }>; note?: string;
  /** 충돌로 needs_review가 되기 전의 상태. 충돌이 풀리면 이 상태로 되돌린다(병합 내부용). */
  basis?: { status: FieldStatus; note?: string };
}
export const missing = <T>(): FieldValue<T> => ({ value: null, status: 'missing' });
