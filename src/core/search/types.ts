export interface SearchDoc { id: string; kind: 'fields' | 'detail' | 'attachment'; label: string; kindLabel: string; textPath?: string; priority: number; lines: string[] }
export interface SearchUnit { kind: 'line' | 'row'; start: number; end: number; lines: number[]; norm: string; /** norm[i] → { line, col } */ map: Array<{ line: number; col: number; /** 묶음 끝 열(배타). 없으면 col+1 */ end?: number }> }
export interface SearchQuery { terms: string[]; phrases: string[]; raw: string }
export interface SearchSpan { line: number; from: number; to: number }  // 원문 줄, displayLine 기준 열
export interface SearchHit { docId: string; unit: number; line: number; spans: SearchSpan[]; snippet: string }
export interface SearchGroup { doc: SearchDoc; hits: SearchHit[]; total: number; truncated: boolean }
