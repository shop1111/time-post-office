import { z } from "zod";
import { canConfigureModels, isLoopback, MODEL_ROLES, setLocalModel } from "@/lib/ai/local-settings";

const role = z.enum(MODEL_ROLES);
const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    role,
    baseUrl: z.string().trim().url().max(2048),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7E]+$/),
  }),
  z.object({ action: z.literal("reset"), role }),
]);

export async function PUT(req: Request) {
  const host = req.headers.get("host");
  if (!canConfigureModels(host)) return new Response(null, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin !== `http://${host}` && origin !== `https://${host}`) {
    return Response.json({ error: "请从本地设置页操作。" }, { status: 403 });
  }

  const result = updateSchema.safeParse(await req.json().catch(() => null));
  if (!result.success) {
    return Response.json({ error: "请填写有效的接口地址、模型名称和 API 密钥。" }, { status: 400 });
  }
  const update = result.data;
  if (update.action === "reset") {
    setLocalModel(update.role, null);
  } else {
    const url = new URL(update.baseUrl);
    const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
    if (!allowedProtocol || url.username || url.password || url.search || url.hash) {
      return Response.json({ error: "接口地址请使用 HTTPS，本机服务可用 HTTP。地址中不要填写密钥或查询参数。" }, { status: 400 });
    }
    setLocalModel(update.role, {
      baseUrl: url.href.replace(/\/+$/, ""),
      model: update.model,
      apiKey: update.apiKey,
    });
  }
  return new Response(null, { status: 204 });
}
