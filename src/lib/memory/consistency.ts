import type { Prisma } from "@prisma/client";

export type MemoryStatus = "active" | "retracted";

export type InvalidationReason =
  | "memory_created"
  | "memory_corrected"
  | "memory_retracted"
  | "entry_deleted";

export interface InvalidateDerivedInput {
  memoryIds?: string[];
  entryId?: string;
  reason: InvalidationReason;
}

export interface InvalidateDerivedResult {
  derivedRevision: number;
}

/** Shared by invalidation and the subsequent profile/recap integration. */
export const DERIVED_REVISION_KEY = "memory.derivedRevision";
export const PROFILE_REVISION_KEY = "memory.profileBuiltRevision";

const REASONS: readonly InvalidationReason[] = [
  "memory_created", "memory_corrected", "memory_retracted", "entry_deleted",
];

/**
 * Call inside the SAME interactive transaction as the memory mutation.
 * Database operations only: bump the revision, mark the profile stale (-1),
 * and discard all monthly recap caches. Model calls/rebuilds belong outside it.
 * Profile/recap readers must separately adopt this revision protocol.
 */
export async function invalidateDerived(
  input: InvalidateDerivedInput,
  tx: Prisma.TransactionClient,
): Promise<InvalidateDerivedResult> {
  const hasMemoryIds = input.memoryIds !== undefined && input.memoryIds.length > 0;
  if ((!input.entryId?.trim() && !hasMemoryIds)
    || (input.entryId !== undefined && !input.entryId.trim())
    || input.memoryIds?.some((id) => !id.trim())
    || !REASONS.includes(input.reason)) {
    throw new Error("invalidateDerived requires a non-empty entryId or memoryIds and a valid reason");
  }

  // Atomic SQLite upsert: concurrent callers cannot read the same revision and
  // both write revision + 1. Lock contention is left to the enclosing transaction.
  const previous = await tx.setting.findUnique({ where: { key: DERIVED_REVISION_KEY } });
  if (previous && !/^(0|[1-9]\d*)$/.test(previous.value)) {
    throw new Error("Invalid memory derived revision");
  }
  await tx.$executeRaw`
    INSERT INTO "Setting" ("key", "value") VALUES (${DERIVED_REVISION_KEY}, '1')
    ON CONFLICT("key") DO UPDATE
    SET "value" = CAST(CAST("Setting"."value" AS INTEGER) + 1 AS TEXT)
  `;
  const revision = await tx.setting.findUniqueOrThrow({ where: { key: DERIVED_REVISION_KEY } });
  const derivedRevision = Number(revision.value);
  if (!Number.isSafeInteger(derivedRevision) || derivedRevision < 1) {
    throw new Error("Memory derived revision exceeds the supported range");
  }

  await tx.setting.upsert({
    where: { key: PROFILE_REVISION_KEY },
    create: { key: PROFILE_REVISION_KEY, value: "-1" },
    update: { value: "-1" },
  });
  await tx.monthlyRecap.deleteMany();
  return { derivedRevision };
}
