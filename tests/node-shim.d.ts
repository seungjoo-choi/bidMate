// @types/node 없이 픽스처 읽기에 필요한 최소 선언.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
