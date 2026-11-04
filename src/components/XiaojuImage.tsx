import Image from "next/image";
import { cn } from "@/lib/utils";

type XiaojuScene = "home" | "welcome" | "listen" | "organize" | "incoming" | "compose" | "memory";

export function XiaojuImage({ scene, className, priority }: {
  scene: XiaojuScene;
  className: string;
  priority?: boolean;
}) {
  return (
    <span className={cn("relative block shrink-0", className)}>
      <Image src={`/xiaoju/${scene}.webp`} alt="" fill unoptimized priority={priority} className="object-contain" />
    </span>
  );
}
