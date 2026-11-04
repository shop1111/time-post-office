import { parseJson } from "@/lib/db";

export interface SourceRef { id: string; revision: number }
export function sourceRefs(value: unknown): SourceRef[] {
  return Array.isArray(value) ? value.filter((r): r is SourceRef => !!r && typeof r.id === "string" && Number.isInteger(r.revision) && r.revision >= 0) : [];
}
export function sourcesOfPlan(plan: string | null): SourceRef[] {
  return sourceRefs(parseJson<{ sourceRefs?: unknown }>(plan, {}).sourceRefs);
}
export function sourcesValid(refs: SourceRef[], active: Map<string, number>) {
  return refs.every((r) => active.get(r.id) === r.revision);
}
