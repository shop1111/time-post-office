/** 单机进程内按记录协调；globalThis 保证开发热更新也共用锁。 */
const state = globalThis as unknown as { entryInterviews?: Map<string, Promise<void>> };
const interviews = state.entryInterviews ??= new Map();

export function tryStartInterview(entryId: string): (() => void) | null {
  if (interviews.has(entryId)) return null;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  interviews.set(entryId, done);
  return () => {
    if (interviews.get(entryId) === done) interviews.delete(entryId);
    finish();
  };
}
