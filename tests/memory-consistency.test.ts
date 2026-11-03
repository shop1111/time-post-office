import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DERIVED_REVISION_KEY, PROFILE_REVISION_KEY, invalidateDerived,
  type InvalidateDerivedInput,
} from "@/lib/memory/consistency";

const root = fileURLToPath(new URL("../", import.meta.url));
const tempDir = mkdtempSync(path.join(os.tmpdir(), "time-post-office-consistency-"));
const databaseUrl = `file:${path.join(tempDir, "test.db").replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const schemaPath = path.join(root, "prisma/schema.prisma");

function pushSchema(schema: string) {
  execFileSync(process.execPath, [
    path.join(root, "node_modules/prisma/build/index.js"),
    "db", "push", "--skip-generate", "--schema", schema,
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: "1" },
    stdio: "pipe",
    timeout: 30_000,
  });
}

beforeAll(async () => {
  // Upgrade an existing database, rather than testing only an empty schema.
  await db.$queryRaw`SELECT 1`;
  const oldSchema = readFileSync(schemaPath, "utf8")
    .replace(/^\s*status\s+String\s+@default\("active"\).*\r?\n/m, "\n")
    .replace(/^\s*revision\s+Int\s+@default\(0\).*\r?\n/m, "\n")
    .replace(/^\s*retractedAt\s+DateTime\?.*\r?\n/m, "\n");
  const oldSchemaPath = path.join(tempDir, "before.prisma");
  writeFileSync(oldSchemaPath, oldSchema);
  pushSchema(oldSchemaPath);
  await db.$executeRaw`
    INSERT INTO "Memory" ("id", "kind", "content", "occurredAt", "userEdited")
    VALUES ('existing', 'fact', '用户已经更正的原有记忆', CURRENT_TIMESTAMP, true)
  `;
  pushSchema(schemaPath);
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
  // Only remove the exact temporary directory allocated by this test suite.
  if (path.dirname(tempDir) === path.resolve(os.tmpdir())
    && path.basename(tempDir).startsWith("time-post-office-consistency-")) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Memory schema compatibility", () => {
  it("adds active/0/null defaults without losing existing user corrections", async () => {
    const memory = await db.memory.findUniqueOrThrow({ where: { id: "existing" } });
    expect(memory).toMatchObject({
      content: "用户已经更正的原有记忆", userEdited: true,
      status: "active", revision: 0, retractedAt: null,
    });
  });
});

describe("transactional derived data invalidation", () => {
  beforeEach(async () => {
    await db.setting.deleteMany();
    await db.monthlyRecap.deleteMany();
    await db.memory.deleteMany({ where: { id: { not: "existing" } } });
    await db.profile.deleteMany();
    await db.profile.create({ data: { summary: "历史画像", traits: '["认真"]' } });
    await db.monthlyRecap.createMany({ data: [
      { month: "2026-09", payload: '{"title":"旧回忆一"}' },
      { month: "2026-10", payload: '{"title":"旧回忆二"}' },
    ] });
    await db.setting.createMany({ data: [
      { key: PROFILE_REVISION_KEY, value: "0" },
      { key: "clockOffsetMs", value: "604800000" },
    ] });
  });

  it("creates a revision, marks the profile stale and discards every monthly cache", async () => {
    const result = await db.$transaction((tx) => invalidateDerived({
      memoryIds: ["existing"], reason: "memory_corrected",
    }, tx));
    expect(result).toEqual({ derivedRevision: 1 });
    expect(await db.setting.findUnique({ where: { key: DERIVED_REVISION_KEY } })).toMatchObject({ value: "1" });
    expect(await db.setting.findUnique({ where: { key: PROFILE_REVISION_KEY } })).toMatchObject({ value: "-1" });
    expect(await db.monthlyRecap.count()).toBe(0);
    expect(await db.profile.findUnique({ where: { id: "me" } })).toMatchObject({ summary: "历史画像" });
    expect(await db.setting.findUnique({ where: { key: "clockOffsetMs" } })).toMatchObject({ value: "604800000" });
    expect(await db.memory.findUnique({ where: { id: "existing" } })).toMatchObject({ status: "active", userEdited: true });
  });

  it("accepts entry-only invalidation after the source has been deleted", async () => {
    await expect(db.$transaction((tx) => invalidateDerived({
      entryId: "already-deleted-entry", reason: "entry_deleted",
    }, tx))).resolves.toEqual({ derivedRevision: 1 });
  });

  it("increments the shared revision for subsequent changes", async () => {
    for (const reason of ["memory_created", "memory_corrected", "memory_retracted"] as const) {
      await db.$transaction((tx) => invalidateDerived({ entryId: "entry", reason }, tx));
    }
    expect(await db.setting.findUnique({ where: { key: DERIVED_REVISION_KEY } })).toMatchObject({ value: "3" });
  });

  it("rolls back the memory mutation, profile marker, counter and caches together", async () => {
    await expect(db.$transaction(async (tx) => {
      await tx.memory.update({ where: { id: "existing" }, data: {
        status: "retracted", revision: { increment: 1 }, retractedAt: new Date(),
      } });
      await invalidateDerived({ memoryIds: ["existing"], reason: "memory_retracted" }, tx);
      throw new Error("later transaction step failed");
    })).rejects.toThrow("later transaction step failed");
    expect(await db.memory.findUnique({ where: { id: "existing" } })).toMatchObject({
      status: "active", revision: 0, retractedAt: null,
    });
    expect(await db.setting.findUnique({ where: { key: DERIVED_REVISION_KEY } })).toBeNull();
    expect(await db.setting.findUnique({ where: { key: PROFILE_REVISION_KEY } })).toMatchObject({ value: "0" });
    expect(await db.monthlyRecap.count()).toBe(2);
  });

  it("propagates an invalidation failure and rolls back the source mutation", async () => {
    await db.setting.create({ data: { key: DERIVED_REVISION_KEY, value: "invalid" } });
    await expect(db.$transaction(async (tx) => {
      await tx.memory.update({ where: { id: "existing" }, data: { content: "不应保存" } });
      await invalidateDerived({ memoryIds: ["existing"], reason: "memory_corrected" }, tx);
    })).rejects.toThrow("Invalid memory derived revision");
    expect(await db.memory.findUnique({ where: { id: "existing" } })).toMatchObject({ content: "用户已经更正的原有记忆" });
    expect(await db.monthlyRecap.count()).toBe(2);
  });

  it.each([
    { reason: "memory_created" },
    { memoryIds: [], reason: "memory_created" },
    { memoryIds: [" "], reason: "memory_retracted" },
    { entryId: " ", reason: "entry_deleted" },
    { entryId: "entry", reason: "unknown" },
  ])("rejects invalid input without changing derived data: %j", async (input) => {
    await expect(db.$transaction((tx) => invalidateDerived(input as InvalidateDerivedInput, tx))).rejects.toThrow("invalidateDerived requires");
    expect(await db.setting.findUnique({ where: { key: DERIVED_REVISION_KEY } })).toBeNull();
    expect(await db.monthlyRecap.count()).toBe(2);
  });
});
