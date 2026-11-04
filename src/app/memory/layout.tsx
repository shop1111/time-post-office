import { MemoryNavigation } from "@/components/memory/MemoryNavigation";

export default function MemoryLayout({ children }: { children: React.ReactNode }) {
  return <><MemoryNavigation />{children}</>;
}
