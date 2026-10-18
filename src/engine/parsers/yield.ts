/** 이벤트 루프에 실행권을 넘긴다(offscreen이 job/abort 등에 응답할 수 있게). */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
