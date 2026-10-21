import type { EvalRaw } from '../../adapters/g2b/eval-api';
import { noticeIdOf } from '../model/ids';
import type { EvalBidder, EvalItem, EvalJudge, EvalRecord, EvalScore } from '../types/evaluation';
import { decodeHtmlEntities as txt } from '../templates/escape';

export type MapEvalResult = { ok: true; record: EvalRecord } | { ok: false; code: 'EVAL_PARSE'; message: string };

const fail = (message: string): MapEvalResult => ({ ok: false, code: 'EVAL_PARSE', message });

/** 허용 목록(EvalRaw)을 저장 형식으로 바꾼다. elmbHashVal은 위원 순번 조인에만 쓰고 결과에 남기지 않는다. */
export function mapEvalRaw(raw: EvalRaw, ref: { noticeNo: string; round?: string }, nowIso: string): MapEvalResult {
  const round = ref.round ?? '000';
  const warnings: string[] = [];

  const evalNo = raw.open.evlNo;
  if (!evalNo) return fail('평가번호가 없습니다.');

  const bidders: EvalBidder[] = raw.targets.map((t) => {
    const bizNo = t.bzmnRegNo.replace(/\D/g, '');
    if (bizNo.length !== 10) warnings.push(`사업자번호가 10자리가 아닙니다: ${t.etpsNm}`);
    return { seq: t.evlTrgtSqno, bizNo, name: txt(t.etpsNm), order: t.prsntnOdr, excluded: t.evlExclYn === 'Y' };
  });

  const judgeOf = new Map<string, number>(); // 지역 변수로만 쓰고 버린다
  const judges: EvalJudge[] = raw.members.map((m, i) => {
    judgeOf.set(m.elmbHashVal, i + 1);
    return { index: i + 1, key: m.elmbNo, excluded: m.evlExclYn === 'Y', completed: m.evlCmptnYn === 'Y' };
  });

  const parentNos = new Set(raw.items.map((i) => i.upEvlPritmNo).filter((v): v is string => !!v));
  const items: EvalItem[] = raw.items.map((i) => {
    const names = [i.evlPritmNmDepth1, i.evlPritmNmDepth2, i.evlPritmNmDepth3, i.evlPritmNmDepth4].filter((n): n is string => !!n && n.trim() !== '').map(txt);
    return {
      no: i.evlPritmNo, parentNo: i.upEvlPritmNo || null, sheetNo: i.evstNo, depth: names.length, names,
      maxScore: i.alptScr, method: i.evlPritmRsltApprMthdNm, leaf: !parentNos.has(i.evlPritmNo),
    };
  });
  const leafItems = items.filter((i) => i.leaf);

  const scores: EvalScore[] = [];
  const seen = new Set<string>();
  const seqs = new Set(bidders.map((b) => b.seq));
  const leafNos = new Set(leafItems.map((i) => i.no));
  let unknownJudge = 0;
  let unknownBidder = 0;
  let nonLeaf = 0;
  let dup = 0;
  for (const x of raw.scores) {
    const j = judgeOf.get(x.elmbHashVal);
    if (j === undefined) { unknownJudge++; continue; }
    if (!seqs.has(x.evlTrgtSqno)) { unknownBidder++; continue; }
    if (!leafNos.has(x.evlPritmNo)) { nonLeaf++; continue; }
    if (x.evlScr === null) continue;
    const key = `${x.evlTrgtSqno}|${j}|${x.evlPritmNo}`;
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);
    const r = x.rvsoEvlHistScr;
    scores.push({ b: x.evlTrgtSqno, j, i: x.evlPritmNo, s: x.evlScr, ...(r !== null && r !== x.evlScr ? { r } : {}) });
  }
  if (unknownJudge > 0) warnings.push(`위원을 찾지 못한 점수 ${unknownJudge}건을 제외했습니다.`);
  if (unknownBidder > 0) warnings.push(`업체를 찾지 못한 점수 ${unknownBidder}건을 제외했습니다.`);
  if (nonLeaf > 0) warnings.push(`세부항목이 아닌 항목의 점수 ${nonLeaf}건을 제외했습니다.`);
  if (dup > 0) warnings.push(`중복된 점수 ${dup}건을 제외했습니다.`);

  if (bidders.length === 0) return fail('평가 대상 업체가 없습니다.');
  if (judges.length === 0) return fail('평가위원이 없습니다.');
  if (leafItems.length === 0) return fail('세부평가항목이 없습니다.');
  if (scores.length === 0) return fail('점수가 없습니다.');

  const expected = bidders.length * judges.length * leafItems.length;
  if (scores.length !== expected) warnings.push(`점수 칸 수가 예상(${expected})과 다릅니다: ${scores.length}`);

  const base = raw.base;
  return {
    ok: true,
    record: {
      schemaVersion: 1,
      noticeId: noticeIdOf({ noticeNo: ref.noticeNo, round }), noticeNo: ref.noticeNo, round,
      evalNo, title: txt(base?.evlNm ?? ''), orgName: txt(base?.dmstUntyGrpNm ?? ''),
      evalKindName: base?.evlSeNm ?? null, techMethodName: base?.techEvlMthdNm ?? null, techWeight: base?.techEvlAlptRt ?? null,
      excludeBestWorst: base ? base.bestLwstScr2ExclYn === 'Y' : null,
      status: base?.evlPgstNm === '확정' ? 'final' : 'provisional', evaluatedAt: base?.evlEndDt ?? null,
      bidders, judges, items, scores, official: null, warnings, collectedAt: nowIso, firstCollectedAt: nowIso,
    },
  };
}
