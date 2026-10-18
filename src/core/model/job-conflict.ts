import type { Job } from '../types/job';

const pad3 = (s: string) => s.padStart(3, '0');

/** 같은 공고번호이고, 차수가 같거나 어느 한쪽이 미지정이면 충돌. 둘 다 지정되고 다르면 별개(정정공고). */
export function refsConflict(a: { noticeNo: string; round?: string }, b: { noticeNo: string; round?: string }): boolean {
  if (a.noticeNo !== b.noticeNo) return false;
  if (a.round === undefined || b.round === undefined) return true;
  return pad3(a.round) === pad3(b.round);
}

/** collect/download_retry/extract는 공고 쓰기군, compose는 별도군. */
const groupOf = (t: Job['type']): 'notice' | 'compose' => (t === 'compose' ? 'compose' : 'notice');

export type ConflictKey = Pick<Job, 'type' | 'ref' | 'noticeId'>;

export interface NoticeKey { noticeNo: string; round?: string }

/** noticeId(`X-000`) 또는 ref를 `{noticeNo, round?}`로 정규화한다. round '00'/빈 값은 미지정, 숫자는 3자리로 맞춘다. */
export function normalizeNoticeKey(v: string | { noticeNo: string; round?: string }): NoticeKey {
  let noticeNo: string;
  let round: string | undefined;
  if (typeof v === 'string') {
    const i = v.lastIndexOf('-');
    noticeNo = i < 0 ? v : v.slice(0, i);
    round = i < 0 ? undefined : v.slice(i + 1);
  } else {
    noticeNo = v.noticeNo;
    round = v.round;
  }
  round = round?.trim();
  if (!round || round === '00') return { noticeNo };
  return { noticeNo, round: /^\d+$/.test(round) ? pad3(String(Number(round))) : round.toUpperCase() };
}

const keyOf = (j: ConflictKey): NoticeKey | undefined =>
  j.ref ? normalizeNoticeKey(j.ref) : j.noticeId ? normalizeNoticeKey(j.noticeId) : undefined;

/** 같은 군이면서 정규화한 공고 식별이 충돌하면(공고번호 같고 차수가 같거나 한쪽 미지정) 동시에 실행할 수 없다. */
export function jobsConflict(a: ConflictKey, b: ConflictKey): boolean {
  if (groupOf(a.type) !== groupOf(b.type)) return false;
  const ka = keyOf(a);
  const kb = keyOf(b);
  if (!ka || !kb || ka.noticeNo !== kb.noticeNo) return false;
  return ka.round === undefined || kb.round === undefined || ka.round === kb.round;
}
