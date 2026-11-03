/** 单进程统一串行队列：一个动作的时钟变动与巡检不可交叉，失败也必须释放队列。 */
const shared = globalThis as unknown as { postmanTail?: Promise<void> };
export function serializePostman<T>(work: () => Promise<T>): Promise<T> {
  const task = (shared.postmanTail ?? Promise.resolve()).then(work);
  shared.postmanTail = task.then(() => {}, () => {});
  return task;
}
