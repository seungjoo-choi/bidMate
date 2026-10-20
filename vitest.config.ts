import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests/eval은 온라인 평가(외부 API 호출)라 기본 실행에서 제외. vitest.eval.config.ts로 실행한다.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], exclude: ['**/node_modules/**', 'tests/eval/**'] },
});
