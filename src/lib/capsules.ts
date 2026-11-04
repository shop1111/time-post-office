import type { Prisma } from "@prisma/client";

/**
 * 胶囊 = 照片 / 语音 / 文字记录。你写的信也会被整理成一条 type = "letter" 的记录进入记忆，
 * 但它不是胶囊，列表、统计和小局的胶囊触发器都要把它排除。
 */
export const LETTER_ENTRY_TYPE = "letter";
export const CAPSULE_WHERE: Prisma.EntryWhereInput = { type: { not: LETTER_ENTRY_TYPE } };
