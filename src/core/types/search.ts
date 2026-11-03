import type { DocKind } from '../extraction/classify';
import type { AiProvider } from './ai';
import type { ISODate } from './common';
import type { AttachmentOrigin } from './notice';

/** notice/texts 응답의 문서 하나. detail은 나라장터 상세화면 전문, attachment는 첨부 파싱 txt. */
export interface NoticeTextFile {
  id: string; kind: 'detail' | 'attachment'; textPath: string; name: string;
  docKind?: DocKind; origin?: AttachmentOrigin; attachmentId?: string; innerPath?: string;
  priority: number; text: string; truncated: boolean;
}
export interface NoticeTexts {
  noticeId: string; extractionJobId: string | null; files: NoticeTextFile[];
  skipped: Array<{ name: string; reason: string }>; totalChars: number;
}

/** 2단계(AI 질문) 타입. 인용 위치만 검증하며 답의 값은 검증하지 않는다. */
export interface AskCitation { file: string | null; page: number | null; quote: string; note: string; located: { docId: string; textPath: string; line: number; endLine: number; page: number | null } | null; partial?: boolean }
export interface AskConflict { topic: string; values: Array<{ file: string; quote: string; value: string; located: AskCitation['located']; partial?: boolean }> }
export interface AskRecord { id: string; createdAt: ISODate; finishedAt?: ISODate; question: string; provider: AiProvider; model: string; promptVersion: string; contextMode: 'context' | 'full'; contextChars: number; files: Array<{ docId: string; name: string; chars: number }>; status: 'done' | 'failed' | 'cancelled'; answer?: string; coverage?: 'answered' | 'partial' | 'not_found'; citations: AskCitation[]; conflicts: AskConflict[]; usage?: { inputTokens: number; outputTokens: number }; error?: { code: string; message: string }; warnings: string[]; promptPath: string; responsePath?: string; extractionJobId: string | null; detailCapturedAt?: ISODate }
export interface AskFile { schemaVersion: 1; noticeId: string; asks: AskRecord[] }  // 최신 먼저, 최대 ASK_MAX_RECORDS=30
