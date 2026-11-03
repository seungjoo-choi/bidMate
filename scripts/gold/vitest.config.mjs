import path from 'node:path';
import { defineConfig } from 'vitest/config';
const G = path.dirname(new URL(import.meta.url).pathname);
export default defineConfig({ root: G, test: { environment: 'node', include: ['measure.test.ts'], testTimeout: 3600000 } });
