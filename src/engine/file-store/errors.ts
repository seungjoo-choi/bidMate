export class FsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FsError';
  }
}
