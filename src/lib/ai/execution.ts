import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionInfo } from "@/lib/types";

// 不改画像模块签名；上下文按异步调用链隔离，避免并行任务串 execution。
const observer = new AsyncLocalStorage<(info: ExecutionInfo) => void>();
export function observeJsonExecution<T>(onExecution: (info: ExecutionInfo) => void, work: () => Promise<T>): Promise<T> {
  return observer.run(onExecution, work);
}
export function reportJsonExecution(info: ExecutionInfo) { observer.getStore()?.(info); }
