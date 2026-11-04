import { PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync, mkdirSync, renameSync } from "fs";
import path from "path";
import crypto from "crypto";
import { runInScope, type DbScope } from "./db";

/**
 * 数据目录布局（DATA_DIR，默认 ./data）：
 *   auth.db                 账号与会话
 *   template.db             空模板，新用户注册时复制一份
 *   users/<userId>/app.db   该用户的全部业务数据
 *   users/<userId>/uploads/ 该用户上传的照片和语音
 *
 * 这里不依赖 Next.js，命令行脚本（种子数据、迁移旧数据）也能用。
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
export const AUTH_DB = path.join(DATA_DIR, "auth.db");
export const TEMPLATE_DB = path.join(DATA_DIR, "template.db");

const fileUrl = (file: string) => `file:${file.replace(/\\/g, "/")}`;

/** userId 来自 cuid；校验一遍，防止任何路径穿越 */
export function userDir(userId: string) {
  if (!/^[a-z0-9]{8,40}$/i.test(userId)) throw new Error("非法的用户 id");
  return path.join(DATA_DIR, "users", userId);
}
export const userDbFile = (userId: string) => path.join(userDir(userId), "app.db");
export const userUploadDir = (userId: string) => path.join(userDir(userId), "uploads");

/** 闲置这么久的用户库连接会被关闭，下次访问时重新打开 */
const IDLE_MS = 30 * 60_000;
const MAX_OPEN = Number(process.env.MAX_OPEN_USER_DBS) || 200;

const g = globalThis as unknown as {
  tpoAuthDb?: PrismaClient;
  tpoUserClients?: Map<string, DbScope>;
  tpoSweeper?: ReturnType<typeof setInterval>;
};

export const authDb: PrismaClient = (g.tpoAuthDb ??= new PrismaClient({ datasourceUrl: fileUrl(AUTH_DB) }));
const clients: Map<string, DbScope> = (g.tpoUserClients ??= new Map());

export class MissingTemplateError extends Error {
  constructor() {
    super(`找不到数据库模板 ${TEMPLATE_DB}。请先在服务器上运行 npm run db:push`);
    this.name = "MissingTemplateError";
  }
}

/** 第一次使用时从模板复制出该用户的库（先写临时文件再改名，避免半截文件） */
export function provisionUserDb(userId: string) {
  const file = userDbFile(userId);
  if (existsSync(file)) return;
  if (!existsSync(TEMPLATE_DB)) throw new MissingTemplateError();
  mkdirSync(userUploadDir(userId), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  copyFileSync(TEMPLATE_DB, tmp);
  renameSync(tmp, file);
}

function sweep() {
  const cutoff = Date.now() - IDLE_MS;
  const entries = [...clients.values()].sort((a, b) => a.lastUsed - b.lastUsed);
  entries.forEach((scope, i) => {
    if (scope.lastUsed < cutoff || entries.length - i > MAX_OPEN) {
      clients.delete(scope.userId);
      void scope.client.$disconnect().catch(() => {});
    }
  });
}

export function userScope(userId: string): DbScope {
  let scope = clients.get(userId);
  if (!scope) {
    provisionUserDb(userId);
    scope = { userId, client: new PrismaClient({ datasourceUrl: fileUrl(userDbFile(userId)) }), lastUsed: Date.now() };
    clients.set(userId, scope);
    if (clients.size > MAX_OPEN) sweep();
    if (!g.tpoSweeper) {
      g.tpoSweeper = setInterval(sweep, 5 * 60_000);
      g.tpoSweeper.unref?.();
    }
  }
  scope.lastUsed = Date.now();
  return scope;
}

/** 以某个用户的身份执行：期间所有 `db` 访问都落在该用户自己的库里 */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return runInScope(userScope(userId), fn);
}

/** 命令行脚本结束时调用 */
export async function disconnectAll() {
  await Promise.all([...clients.values()].map((s) => s.client.$disconnect().catch(() => {})));
  clients.clear();
  await authDb.$disconnect().catch(() => {});
}
