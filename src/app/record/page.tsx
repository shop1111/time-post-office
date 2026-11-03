import { RecordFlow } from "@/components/record/RecordFlow";
import { now } from "@/lib/clock";

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const t = await now();
  const initial = type === "photo" || type === "voice" ? type : "text";
  return <RecordFlow initialType={initial} today={t.toISOString()} />;
}
