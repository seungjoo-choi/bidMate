export interface AttachLimits { perFileBytes?: number; totalBytes?: number }

/** 첨부 대상 선별. 초안 순서를 유지하고, 큰 파일만 건너뛰며 다음 파일은 계속 판정한다. */
export function selectAttachTargets<F extends { size: number }>(
  files: F[], maxBytes: number, limits: AttachLimits = {},
): { targets: F[]; skipped: Array<{ file: F; error: 'FILE_TOO_LARGE' | 'PROVIDER_FILE_LIMIT' | 'PROVIDER_TOTAL_LIMIT' }> } {
  const targets: F[] = [];
  const skipped: Array<{ file: F; error: 'FILE_TOO_LARGE' | 'PROVIDER_FILE_LIMIT' | 'PROVIDER_TOTAL_LIMIT' }> = [];
  let total = 0;
  for (const file of files) {
    if (file.size > maxBytes) { skipped.push({ file, error: 'FILE_TOO_LARGE' }); continue; }
    if (limits.perFileBytes !== undefined && file.size > limits.perFileBytes) { skipped.push({ file, error: 'PROVIDER_FILE_LIMIT' }); continue; }
    if (limits.totalBytes !== undefined && total + file.size > limits.totalBytes) { skipped.push({ file, error: 'PROVIDER_TOTAL_LIMIT' }); continue; }
    total += file.size;
    targets.push(file);
  }
  return { targets, skipped };
}
