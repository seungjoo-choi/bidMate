import type { DocFormat, DocModel } from '../../core/doc/model';

export type { DocFormat };
export type Container = 'zip';
export interface ParseInput { name: string; bytes: Uint8Array; signal?: AbortSignal; deadlineAt: number }
export type ParseFailReason = 'unsupported' | 'encrypted' | 'drm' | 'scanned' | 'corrupt' | 'timeout' | 'cancelled';
export type ParseResult = { ok: true; doc: DocModel } | { ok: false; reason: ParseFailReason; message: string };
export interface DocParser { id: string; format: DocFormat; parse(input: ParseInput): Promise<ParseResult> }
export type DetectedFormat = DocFormat | Container | 'hwp3' | 'unknown';
export interface ParserRegistry {
  detect(name: string, head: Uint8Array, bytes: Uint8Array): DetectedFormat;
  get(format: DocFormat): DocParser;
}
export interface PdfEnv { workerSrc?: string; cMapUrl: string; standardFontDataUrl: string }
