import Link from "next/link";
import { CORRESPONDENT_KIND_LABEL, type CorrespondentKind } from "@/lib/types";
import { fmtCN } from "@/lib/utils";

export interface CorrespondentData {
  id: string;
  kind: string;
  name: string;
  relation: string;
  moment: string;
  momentAt: string | null;
  letters: number;
}

const ICON: Record<string, string> = { person: "✉️", parallel_self: "🪐", future_self: "💌", curator: "📮" };

export function CorrespondentCard({ c }: { c: CorrespondentData }) {
  const sub =
    c.kind === "person"
      ? `${c.momentAt ? `${fmtCN(c.momentAt)} · ` : ""}${c.moment}`
      : c.kind === "parallel_self"
        ? `${c.momentAt ? `${fmtCN(c.momentAt)}分岔 · ` : ""}${c.moment}`
        : c.relation;
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{ICON[c.kind] ?? "✉️"}</span>
        <span className="font-hand text-lg">{c.name}</span>
        <span className="rounded bg-paper-2 px-1.5 text-[11px] text-ink-3">{CORRESPONDENT_KIND_LABEL[c.kind as CorrespondentKind] ?? c.kind}</span>
      </div>
      <p className="line-clamp-2 text-sm text-ink-2">{sub || "—"}</p>
      <div className="mt-auto flex items-center gap-3 pt-1 text-sm">
        <Link href={`/mail/write?to=${c.id}`} className="text-stamp underline-offset-4 hover:underline">
          写信
        </Link>
        {c.letters > 0 && (
          <Link href={`/mail/to/${c.id}`} className="text-ink-3 underline-offset-4 hover:underline">
            往来信件 {c.letters}
          </Link>
        )}
      </div>
    </div>
  );
}
