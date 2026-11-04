import { userPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/memory/profile";
import { ChatRoom } from "@/components/chat/ChatRoom";

export const dynamic = "force-dynamic";

async function ChatPage() {
  const [profile, rows] = await Promise.all([
    getProfile(),
    db.chatMessage.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { role: true, content: true } }),
  ]);
  const messages = rows.reverse().map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content }));
  return <ChatRoom initial={messages} userName={profile.name} />;
}

export default userPage(ChatPage);
