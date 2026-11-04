import { db } from "@/lib/db";
import { CURATOR_NAME, VIRTUAL_KINDS, type CorrespondentKind } from "@/lib/types";

/** 小局和「未来的我」是固定收件人，第一次用到时创建 */
export async function ensureSystemCorrespondents() {
  const find = async (kind: CorrespondentKind, name: string, relation: string) =>
    (await db.correspondent.findFirst({ where: { kind }, orderBy: { createdAt: "asc" } })) ??
    db.correspondent.create({ data: { kind, name, relation } });
  const curator = await find("curator", CURATOR_NAME, "时光邮局的局长，替你保管胶囊和信件");
  const futureSelf = await find("future_self", "未来的我", "到了你选的那一天，这封信会由真实的你收到");
  return { curator, futureSelf };
}

export const isVirtual = (kind: string) => (VIRTUAL_KINDS as string[]).includes(kind);

export const INSTANT_REPLIES_KEY = "instantReplies";

export async function instantReplies() {
  const row = await db.setting.findUnique({ where: { key: INSTANT_REPLIES_KEY } });
  return row?.value === "1";
}
