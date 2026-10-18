// pdfjs worker·cmaps·standard_fonts를 WXT public 디렉터리(public/pdfjs)로 복사한다.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'pdfjs-dist');
const out = join(root, 'public', 'pdfjs');

if (!existsSync(pkg)) {
  console.warn('[copy-pdfjs-assets] pdfjs-dist가 없어 건너뜁니다.');
  process.exit(0);
}
mkdirSync(out, { recursive: true });
cpSync(join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'));
cpSync(join(pkg, 'cmaps'), join(out, 'cmaps'), { recursive: true });
cpSync(join(pkg, 'standard_fonts'), join(out, 'standard_fonts'), { recursive: true });
console.log('[copy-pdfjs-assets] 복사 완료:', out);
