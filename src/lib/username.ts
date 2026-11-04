/** 用户名：3~32 位字母、数字、下划线、点、短横线，不区分大小写（统一存小写） */
export function normalizeUsername(raw: unknown) {
  const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[a-z0-9_.-]{3,32}$/.test(name) ? name : null;
}
