/** 주입 함수가 응답에서 골라 돌려주는 최소 필드. 검증은 core에서. */
export interface NwRawUser { id?: unknown; name?: unknown; email?: unknown; orgUnitName?: unknown; orgUnits?: unknown; positionName?: unknown }
export type NwPageFetchResult =
  | { ok: true; totalCount: number; results: NwRawUser[]; pages: number }
  | { ok: false; code: 'NW_NOT_LOGGED_IN' | 'NW_API_ERROR' | 'NW_BAD_RESPONSE'; status?: number; detail?: string };
