// 정답셋 공고의 첨부 원본을 나라장터에서 내려받는다(키 불필요). 사용: node scripts/gold/dl.mjs
import fs from 'node:fs';
import path from 'node:path';
const G = path.dirname(new URL(import.meta.url).pathname);
const notices = JSON.parse(fs.readFileSync(`${G}/data/notices.json`, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const it of notices) {
  const dir = `${G}/files/${it.bidNtceNo}`; fs.mkdirSync(dir, { recursive: true });
  const man = [];
  for (let i = 1; i <= 10; i++) {
    const name = it[`ntceSpecFileNm${i}`], url = it[`ntceSpecDocUrl${i}`];
    if (!name || !url) continue;
    const saved = `${i}_${name.replace(/[\/\\:*?"<>|]/g, '_')}`;
    try {
      if (!fs.existsSync(`${dir}/${saved}`)) {
        const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer());
        if (!r.ok || b.length === 0) throw new Error(`HTTP ${r.status} len ${b.length}`);
        fs.writeFileSync(`${dir}/${saved}`, b);
        await sleep(300);
      }
      man.push({ index: i, name, saved, size: fs.statSync(`${dir}/${saved}`).size });
    } catch (e) { man.push({ index: i, name, error: String(e.message) }); }
  }
  fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(man, null, 1));
  console.log(it.bidNtceNo, man.map((m) => (m.error ? 'ERR' : m.size)).join(','));
}
