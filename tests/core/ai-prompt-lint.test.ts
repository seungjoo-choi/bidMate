import { describe, expect, it } from 'vitest';
import { PROMPT_VERSION } from '../../src/core/ai/prompt';
import { lintExampleMarkers, lintPrompt, renderLintTarget } from '../helpers/prompt-lint';

// v1.1.0은 위반하므로 S2(PROMPT_VERSION 2.x)에서 활성화
const t = PROMPT_VERSION.startsWith('2.') ? it : it.skip;

describe('프롬프트 린트(명세 §2.4)', () => {
  t('S2에서 활성화: 숫자 토큰·금지 어구 없음', () => {
    expect(lintPrompt(renderLintTarget())).toEqual([]);
  });
  t('S2에서 활성화: 예시 줄에 (가상 예) 표시', () => {
    expect(lintExampleMarkers(renderLintTarget())).toEqual([]);
  });
});
