import fs from 'node:fs';
import path from 'node:path';
const G = path.dirname(new URL(import.meta.url).pathname);
const rules = JSON.parse(fs.readFileSync(`${G}/out/${process.argv[2] ?? 'rules-result.json'}`, 'utf8'));
const cands = Object.fromEntries(JSON.parse(fs.readFileSync(`${G}/data/notices.json`, 'utf8')).map((c) => [c.bidNtceNo, c]));
const KEYS = ['postedAt','registrationDeadline','proposalPeriod','proposalEvalAt','budgetAmount','projectPeriod','evalMethod','differentialScoring','credibilityScore','managementScore','performanceScore','performancePeriod','performanceMinAmount','performanceCondition','jointVentureAllowed','priceMethod'];
const norm = (v) => String(v ?? '').replace(/[\s.,·:()\[\]~\-'"‘’“”년월일시분]/g, '').toLowerCase();
const digits = (v) => String(v ?? '').replace(/\D/g, '');
function same(k, g, r) {
  if (r === null || r === undefined) return false;
  if (k === 'jointVentureAllowed' && typeof r === 'boolean') { const t = String(g); const gb = /불허|불가|없음|단독|허용하지|미허용/.test(t) ? false : /공동이행|분담|주계약|허용|가능/.test(t) ? true : null; return gb === r; }
  if (k === 'performancePeriod') { const y = (x) => { const m = String(x).match(/(\d+)\s*(년|개월)/); return m ? m[1] + m[2] : ''; }; return y(g) !== '' && y(g) === y(r); }
  if (k === 'performanceMinAmount') { const amt = (x) => { if (typeof x === 'number') return x; const t = String(x).replace(/,/g, ''); let v = 0; const e = t.match(/(\d+(?:\.\d+)?)\s*억/); const c = t.match(/(\d+(?:\.\d+)?)\s*천만/); const b = t.match(/(\d+(?:\.\d+)?)\s*백만/); const w = t.match(/(\d+(?:\.\d+)?)\s*만\s*원/); if (e) v += +e[1] * 1e8; if (c) v += +c[1] * 1e7; else if (b) v += +b[1] * 1e6; else if (w && !e) v += +w[1] * 1e4; if (!v) { const n = t.match(/(\d{5,})\s*원/); if (n) v = +n[1]; } return v; }; return amt(g) > 0 && amt(g) === amt(r); }
  if (k === 'evalMethod') { const kw = (x) => (String(x).match(/협상|적격|최저가|수의|규격가격|2단계|설계공모/) ?? [''])[0]; const ratio = (x) => (String(x).match(/\d{1,2}(?=\s*(?:점|%|\s*:|\s*\)))/g) ?? []).filter((n) => +n >= 5 && +n <= 95).slice(0, 2).join(','); return kw(g) === kw(r) && (ratio(g) === '' || ratio(g) === ratio(r)); }
  if (typeof g === 'boolean' || typeof r === 'boolean') return String(g) === String(r);
  if (typeof g === 'number' || typeof r === 'number') return Number(digits(g)) === Number(digits(r)) || Number(g) === Number(r);
  if (['postedAt','registrationDeadline','proposalEvalAt'].includes(k)) {
    const d = (x) => { const m = String(x).match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})\D*?(?:\D+(\d{1,2}):(\d{2}))?/); return m ? [m[1].slice(-2), m[2].padStart(2,'0'), m[3].padStart(2,'0'), (m[4]??'').padStart(2,'0'), m[5]??''].join('') : ''; };
    return d(g) !== '' && d(g) === d(r);
  }
  const a = norm(g), b = norm(r);
  if (!a || !b) return false;
  return a === b || (a.length > 6 && b.includes(a.slice(0, 40))) || (b.length > 6 && a.includes(b.slice(0, 40)));
}
const rows = []; const tally = {}; const byType = {};
for (const f of fs.readdirSync(`${G}/data/gold`).filter((f) => f.endsWith('.json'))) {
  const g = JSON.parse(fs.readFileSync(`${G}/data/gold/${f}`, 'utf8')); const no = g.noticeNo; const r = rules[no]; if (!r) continue;
  const ct = /협상/.test(cands[no]?.sucsfbidMthdNm ?? '') ? '협상' : '그외';
  for (const k of KEYS) {
    const gi = g.items[k] ?? { kind: 'missing' }; const ri = r.leaves[k];
    const rs = ri.state, rv = ri.value; const hasV = rv !== null && rv !== undefined && rv !== '';
    let o;
    if (gi.kind === 'value') o = rs === 'not_applicable' ? '틀림(해당없음 오판)' : !hasV ? (rs === 'covered' ? '묶음처리' : '놓침') : same(k, gi.value, rv) ? (rs === 'verified' || rs === 'covered' ? '정답' : '정답(확인필요)') : (rs === 'verified' ? '틀림(확정)' : '틀림(확인필요)');
    else if (gi.kind === 'na') o = rs === 'not_applicable' ? '정답' : hasV ? (rs === 'verified' ? '오탐(확정)' : '오탐(확인필요)') : rs === 'covered' ? '정답(묶음)' : '해당없음 못가림';
    else if (gi.kind === 'absent') o = hasV ? (rs === 'verified' ? '오탐(확정)' : '오탐(확인필요)') : '정답';
    else if (gi.kind === 'multi') o = rs === 'verified' && hasV ? '여러값중 하나 확정' : '정답(확인필요)';
    else o = '정답셋없음';
    tally[k] ??= {}; tally[k][o] = (tally[k][o] ?? 0) + 1;
    byType[ct] ??= {}; byType[ct][k] ??= { ok: 0, n: 0 }; byType[ct][k].n++; if (o.startsWith('정답')) byType[ct][k].ok++;
    rows.push({ no, ct, k, o, gk: gi.kind, gv: gi.value ?? gi.values ?? gi.reason, conf: gi.confidence, rs, rv, rr: ri.reason, quote: gi.quote, file: gi.file });
  }
}
fs.writeFileSync(`${G}/out/compare-rows.json`, JSON.stringify(rows, null, 1));
console.log('notices', new Set(rows.map((r) => r.no)).size);
const cols = [...new Set(rows.map((r) => r.o))].sort();
console.log(['항목'.padEnd(22), ...cols].join(' | '));
for (const k of KEYS) console.log([k.padEnd(22), ...cols.map((c) => String(tally[k]?.[c] ?? '').padStart(c.length))].join(' | '));
for (const [t, v] of Object.entries(byType)) console.log(t, Object.entries(v).map(([k, x]) => `${k}:${x.ok}/${x.n}`).join(' '));
