import type { ISODate } from '../../core/types/common';

/** CS가 SW로 내보내는 허용 목록. 이 인터페이스에 없는 키는 응답에 있어도 복사하지 않는다(개인정보 규칙). */
export interface EvalRaw {
  capturedAt: ISODate;
  open: { evlNo: string | null; epropoEvalYn: string | null; isNego: boolean | null };
  base: { evlNm: string | null; dmstUntyGrpNm: string | null; evlSeNm: string | null; techEvlMthdNm: string | null; techEvlAlptRt: number | null; evlPgstNm: string | null; evlEndDt: string | null; bestLwstScr2ExclYn: string | null; evlUseEvstCnt: number | null } | null;
  targets: Array<{ evlTrgtSqno: number; bzmnRegNo: string; etpsNm: string; prsntnOdr: number | null; evlExclYn: string | null }>;
  members: Array<{ elmbHashVal: string; elmbNo: string | null; evlExclYn: string | null; evlCmptnYn: string | null }>;
  items: Array<{ evstNo: string; evlPritmNo: string; upEvlPritmNo: string | null; evlPritmNoDepth1: string | null; evlPritmNoDepth2: string | null; evlPritmNoDepth3: string | null; evlPritmNoDepth4: string | null; evlPritmNmDepth1: string | null; evlPritmNmDepth2: string | null; evlPritmNmDepth3: string | null; evlPritmNmDepth4: string | null; alptScr: number | null; evlPritmRsltApprMthdNm: string | null }>;
  scores: Array<{ evlTrgtSqno: number; elmbHashVal: string; evlPritmNo: string; evlScr: number | null; rvsoEvlHistScr: number | null }>;
}

export interface EvalEndpoint {
  path: string;
  menuInfo: string;
  submissionid: string;
}

const ORIGIN = 'https://www.g2b.go.kr';
const MENU_OPEN = '{"menuNo":"01523","menuCangVal":"PBOC007_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"02128"}';
const MENU_EVAL = '{"menuNo":"10956","menuCangVal":"EEPZ002_01","bsneClsfCd":"%EC%97%85130033","scrnNo":"00244"}';
const SUB_PREFIX = 'mf_wfm_container_mainWframe_onbsDtlInfo_wframe_popupCnts_DitmRsltChrtInqPV_wframe_popupCnts_';

export const EVAL_ENDPOINTS = {
  open: { path: '/pb/pbo/pboc/OnbsRslt/selectOnbsRsltSbidGods.do', menuInfo: MENU_OPEN, submissionid: 'mf_wfm_container_mainWframe_onbsDtlInfo_wframe_popupCnts_selectOnbsRsltSbidGods' },
  base: { path: '/ee/eep/eepa/evlInfo/selectEvlBaseInfo.do', menuInfo: MENU_EVAL, submissionid: `${SUB_PREFIX}srchEvlBaseInfo` },
  targets: { path: '/ee/eep/eepb/evlTrgt/selectEvlTrgtLst.do', menuInfo: MENU_EVAL, submissionid: `${SUB_PREFIX}sbmSrch1` },
  members: { path: '/ee/eep/eepd/elmb/selectElmbInfo.do', menuInfo: MENU_EVAL, submissionid: `${SUB_PREFIX}sbmSrch2` },
  items: { path: '/ee/eep/eepe/evstevl/selectEvstEvlPritmLst.do', menuInfo: MENU_EVAL, submissionid: `${SUB_PREFIX}sbmSrch3` },
  scores: { path: '/ee/eep/eepe/evstevl/selectDtlsPritmEvlRsltLst.do', menuInfo: MENU_EVAL, submissionid: `${SUB_PREFIX}sbmSrch4` },
} as const satisfies Record<string, EvalEndpoint>;

export type EvalEndpointKey = keyof typeof EVAL_ENDPOINTS;
export const EVAL_ENDPOINT_URL = (k: EvalEndpointKey): string => `${ORIGIN}${EVAL_ENDPOINTS[k].path}`;

const common = (evlNo: string, evstNo = '') => ({ evlNo, evstNo, evlExclYn: 'N', evlTyCd: '평010002', elmbTyCd: '주010008', evlCode: '' });

/** 단계별 요청 본문 빌더 */
export const EVAL_BODIES = {
  open: (noticeNo: string, round: string) => ({
    dlSrchOnbsRsltBidInM: {
      bidPbancNo: noticeNo, bidPbancOrd: round, bidClsfNo: '1', bidPrgrsOrd: '000', prcmBsneSeCd: '03',
      bidPgstCd: '개찰완료', bzmnRegNo: '', reOpenPbancYN: 'Y', currentPage: 1, recordCountPerPage: '10',
    },
  }),
  base: (evlNo: string) => ({ dlSrchEvlInfoM: { evlNo } }),
  targets: (evlNo: string) => ({ dlSrchEvlTrgtM: common(evlNo) }),
  members: (evlNo: string) => ({ dlSrchElmbM: common(evlNo) }),
  items: (evlNo: string) => ({ dSrchEvstEvlM: common(evlNo) }),
  scores: (evlNo: string, evstNo: string) => ({ dSrchEvstEvlM: common(evlNo, evstNo) }),
};

export type G2bJsonParse = { ok: true; json: Record<string, unknown> } | { ok: false; code: 'EVAL_NOT_LOGGED_IN' | 'EVAL_API_ERROR' };

/** 본문이 JSON 객체면 ok. 아니면 앞 200자에 html/login 흔적이 있을 때 EVAL_NOT_LOGGED_IN. */
export function parseG2bJson(text: string): G2bJsonParse {
  try {
    const j = JSON.parse(text) as unknown;
    if (j && typeof j === 'object' && !Array.isArray(j)) return { ok: true, json: j as Record<string, unknown> };
  } catch { /* JSON 아님 */ }
  return { ok: false, code: /<html|login/i.test(text.slice(0, 200)) ? 'EVAL_NOT_LOGGED_IN' : 'EVAL_API_ERROR' };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface EvalResponses {
  open: unknown;
  base: unknown | null;
  targets: unknown;
  members: unknown;
  items: unknown;
  /** evstNo별 6번 응답 */
  scores: unknown[];
}

/** 응답에서 허용 목록의 키만 복사한다. 그 밖의 키(위원 실명, 담당자 정보 등)는 이 함수를 통과하지 못한다. */
export function pickEvalRaw(r: EvalResponses, capturedAt: ISODate): EvalRaw {
  const etc = rec(rec(rec(r.open).result).etcData);
  const b = r.base === null ? null : rec(rec(r.base).dlEvlBaseInfoM);
  return {
    capturedAt,
    open: { evlNo: str(etc.evlNo), epropoEvalYn: str(etc.epropoEvalYn), isNego: typeof etc.isNego === 'boolean' ? etc.isNego : etc.isNego === 'Y' ? true : etc.isNego === 'N' ? false : null },
    base: b === null ? null : {
      evlNm: str(b.evlNm), dmstUntyGrpNm: str(b.dmstUntyGrpNm), evlSeNm: str(b.evlSeNm), techEvlMthdNm: str(b.techEvlMthdNm),
      techEvlAlptRt: num(b.techEvlAlptRt), evlPgstNm: str(b.evlPgstNm), evlEndDt: str(b.evlEndDt),
      bestLwstScr2ExclYn: str(b.bestLwstScr2ExclYn), evlUseEvstCnt: num(b.evlUseEvstCnt),
    },
    targets: arr(rec(r.targets).dlEvlTrgtL).flatMap((t) => {
      const seq = num(t.evlTrgtSqno);
      return seq === null ? [] : [{ evlTrgtSqno: seq, bzmnRegNo: str(t.bzmnRegNo) ?? '', etpsNm: str(t.etpsNm) ?? '', prsntnOdr: num(t.prsntnOdr), evlExclYn: str(t.evlExclYn) }];
    }),
    members: arr(rec(r.members).dlElmbL).map((m) => ({
      elmbHashVal: str(m.elmbHashVal) ?? '', elmbNo: str(m.elmbNo), evlExclYn: str(m.evlExclYn), evlCmptnYn: str(m.evlCmptnYn),
    })),
    items: arr(rec(r.items).dlEvlFlfmtCrstL).flatMap((i) => {
      const no = str(i.evlPritmNo);
      const sheet = str(i.evstNo);
      if (no === null || sheet === null || sheet.trim() === '') return [];
      return [{
        evstNo: sheet, evlPritmNo: no, upEvlPritmNo: str(i.upEvlPritmNo),
        evlPritmNoDepth1: str(i.evlPritmNoDepth1), evlPritmNoDepth2: str(i.evlPritmNoDepth2), evlPritmNoDepth3: str(i.evlPritmNoDepth3), evlPritmNoDepth4: str(i.evlPritmNoDepth4),
        evlPritmNmDepth1: str(i.evlPritmNmDepth1), evlPritmNmDepth2: str(i.evlPritmNmDepth2), evlPritmNmDepth3: str(i.evlPritmNmDepth3), evlPritmNmDepth4: str(i.evlPritmNmDepth4),
        alptScr: num(i.alptScr), evlPritmRsltApprMthdNm: str(i.evlPritmRsltApprMthdNm),
      }];
    }),
    scores: r.scores.flatMap((s) => arr(rec(s).dlDtlsPritmEvlRslL)).flatMap((x) => {
      const seq = num(x.evlTrgtSqno);
      const no = str(x.evlPritmNo);
      if (seq === null || no === null) return [];
      return [{ evlTrgtSqno: seq, elmbHashVal: str(x.elmbHashVal) ?? '', evlPritmNo: no, evlScr: num(x.evlScr), rvsoEvlHistScr: num(x.rvsoEvlHistScr) }];
    }),
  };
}
