/** 나라장터 상세화면 전문(가상 첨부) 상수. collect-job 저장 경로와 검색·AI 입력이 같은 이름을 쓴다. */
export const DETAIL_TEXT_FILE = '[상세] 나라장터 상세화면.txt';
export const DETAIL_TEXT_NAME = '[상세] 나라장터 상세화면';
export const DETAIL_ATTACHMENT_ID = '__detail__';
export const DETAIL_KIND_LABEL = '상세화면';
export const DETAIL_EXCERPT_MAX_CHARS = 10_000;
export const detailTextPath = (folder: string) => `${folder}/source/text/${DETAIL_TEXT_FILE}`;
export const isDetailEvidence = (e: { attachmentId: string }) => e.attachmentId === DETAIL_ATTACHMENT_ID;
