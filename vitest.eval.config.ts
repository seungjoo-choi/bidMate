import { defineConfig } from 'vitest/config';

/** 온라인 AI 평가 전용. `npx vitest run -c vitest.eval.config.ts` (GEMINI_API_KEY 필요) */
export default defineConfig({
  test: { environment: 'node', include: ['tests/eval/**/*.test.ts'] },
});
