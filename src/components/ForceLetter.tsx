"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { TimeTravelOverlay } from "./postman/TimeTravelOverlay";

/** 立即请邮差巡检一次（忽略频控），方便演示；巡检过程用同一条流水线直播 */
export function ForceLetter() {
  const [running, setRunning] = useState(false);
  const router = useRouter();
  const finish = useCallback(() => {
    setRunning(false);
    router.refresh();
  }, [router]);
  return (
    <>
      <button className="btn btn-ghost text-sm" onClick={() => setRunning(true)} disabled={running}>
        <Sparkles size={14} /> 请邮差现在巡检
      </button>
      {running && <TimeTravelOverlay request={{ action: "force" }} onClose={finish} />}
    </>
  );
}
