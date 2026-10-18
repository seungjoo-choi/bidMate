import { EXTRACTION_KEYS, EXTRACTION_SCHEMA_VERSION, type Extraction } from '../types/extraction';

/** 읽기 보정: 옛 스키마에서 빠진 항목을 not_run으로 채운다. 저장 파일은 고쳐 쓰지 않는다. */
export function normalizeExtraction(x: Extraction): Extraction {
  if (!x.items) x.items = {} as Extraction['items'];
  for (const k of EXTRACTION_KEYS) {
    if (!Object.hasOwn(x.items, k)) x.items[k] = { value: null, status: 'not_run' };
  }
  x.schemaVersion = EXTRACTION_SCHEMA_VERSION;
  return x;
}
