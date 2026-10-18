export type DocFormat = 'hwp5' | 'hwpx' | 'pdf' | 'docx' | 'xlsx' | 'txt';

export interface DocLoc { page?: number; sheet?: string; section?: number | string; block: number; line?: number }
export interface DocParagraph { kind: 'p'; text: string; loc: DocLoc }
export interface DocCell { r: number; c: number; rowSpan: number; colSpan: number; text: string; blocks: DocBlock[]; loc: DocLoc }
export interface DocTable {
  kind: 'table'; index: number; rows: number; cols: number; cells: DocCell[];
  caption?: string; /* 직전 문단 ≤80자 */
  loc: DocLoc;
}
export type DocBlock = DocParagraph | DocTable;
export interface DocModel {
  format: DocFormat; blocks: DocBlock[]; pages?: number; warnings: string[];
  stats: { chars: number; tables: number; ms: number };
}
