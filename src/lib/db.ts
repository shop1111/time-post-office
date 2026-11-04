import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";

/**
 * 多用户：每个用户一份独立的 SQLite 库。请求进来时由 withUser / userPage（src/lib/auth.ts）
 * 按登录会话把「当前用户的库」放进 AsyncLocalStorage，业务代码照旧使用 `db`，
 * 访问时才解析到当前用户的 PrismaClient。
 *
 * 没有用户上下文时直接报错（而不是回退到某个默认库），保证不会读写到别人的数据。
 */
export interface DbScope {
  userId: string;
  client: PrismaClient;
  /** 最近一次使用时间，供闲置连接回收（src/lib/tenancy.ts） */
  lastUsed: number;
}

const g = globalThis as unknown as { tpoDbScope?: AsyncLocalStorage<DbScope> };
const storage: AsyncLocalStorage<DbScope> = (g.tpoDbScope ??= new AsyncLocalStorage<DbScope>());

export class NoUserScopeError extends Error {
  constructor() {
    super("当前请求没有登录用户，不能访问数据库（请用 withUser / userPage 包裹，或在脚本里用 runAsUser）");
    this.name = "NoUserScopeError";
  }
}

export function runInScope<T>(scope: DbScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentScope(): DbScope {
  const scope = storage.getStore();
  if (!scope) throw new NoUserScopeError();
  return scope;
}

export const currentUserId = () => currentScope().userId;

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // 被当作 Promise 检查或被调试工具检查时不要抛错
    if (prop === "then" || typeof prop === "symbol") {
      const scope = storage.getStore();
      return scope ? Reflect.get(scope.client, prop, scope.client) : undefined;
    }
    const scope = currentScope();
    scope.lastUsed = Date.now();
    const value = Reflect.get(scope.client, prop, scope.client);
    return typeof value === "function" ? value.bind(scope.client) : value;
  },
});

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
