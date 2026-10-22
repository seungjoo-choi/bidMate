import { REVIEW_LABEL, type ReviewLeafKey } from '../../core/extraction/review-rows';
import type { SearchDoc } from '../../core/search/types';
import type { Extraction } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import { overviewGroups } from '../notice-detail/view';

/** 항목값 가상 문서의 줄 메타. 검토 탭 링크용. 그룹 머리 줄은 label이 빈 문자열. */
export interface FieldLineMeta { groupId: string; label: string; reviewKey?: ReviewLeafKey }
export interface FieldDoc extends SearchDoc { kind: 'fields'; noticeId: string; meta: FieldLineMeta[] }

export const FIELD_DOC_ID = 'fields';
const EMPTY = '—';
const REVIEW_KEY_OF = new Map<string, ReviewLeafKey>((Object.entries(REVIEW_LABEL) as Array<[ReviewLeafKey, string]>).map(([k, l]) => [l, k]));
const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, ' ').trim();

/** 개요 탭에서 보이는 모습 그대로의 가상 문서. 그룹마다 `[그룹 제목]` 머리 줄, 행마다 `라벨: 값` 줄. 값이 `—`인 행은 뺀다. */
export function buildFieldDoc(notice: Notice, extraction: Extraction | null): FieldDoc {
  const lines: string[] = [];
  const meta: FieldLineMeta[] = [];
  for (const g of overviewGroups(notice, [], extraction)) {
    const rows = g.rows.filter((r) => r.value !== EMPTY);
    if (!rows.length) continue;
    lines.push(`[${g.title}]`);
    meta.push({ groupId: g.id, label: '' });
    for (const r of rows) {
      lines.push(`${r.label}: ${oneLine(r.value)}${r.hint ? ` (${oneLine(r.hint)})` : ''}`);
      const reviewKey = REVIEW_KEY_OF.get(r.label);
      meta.push({ groupId: g.id, label: r.label, ...(reviewKey ? { reviewKey } : {}) });
    }
  }
  return { id: FIELD_DOC_ID, kind: 'fields', noticeId: notice.id, label: '공고정보 항목값', kindLabel: '항목값', priority: -1, lines, meta };
}
