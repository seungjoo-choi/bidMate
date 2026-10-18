/** 토큰 이름은 theme.css의 @theme 정의와 동일하다. 각 진입점에서 theme.css를 import한다. */
export const statusTone = {
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-danger',
  idle: 'text-faint',
} as const;
