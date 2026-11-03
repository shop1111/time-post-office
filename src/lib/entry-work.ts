/** 单机进程内按记录协调；globalThis 保证开发热更新也共用锁。 */
const state = globalThis as unknown as { entryInterviews?: Map<string, Promise<void>>; entryFinalizing?: Set<string> };
const interviews: Map<string, Promise<void>> = state.entryInterviews ??= new Map();
const finalizing: Set<string> = state.entryFinalizing ??= new Set();

export function tryStartInterview(entryId: string): (() => void) | null {
  if (interviews.has(entryId) || finalizing.has(entryId)) return null;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  interviews.set(entryId, done);
  return () => {
    if (interviews.get(entryId) === done) interviews.delete(entryId);
    finish();
  };
}

/** 先阻止新追问，再等待已在运行的一轮完成；finalize 本身不返回 busy。 */
export function reserveFinalize(entryId: string) {
  finalizing.add(entryId);
  return { wait: interviews.get(entryId) ?? Promise.resolve(), release: () => { finalizing.delete(entryId); } };
}
