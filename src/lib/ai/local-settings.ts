export const MODEL_ROLES = ["chat", "vision", "embed", "asr"] as const;
export type Role = (typeof MODEL_ROLES)[number];
export interface RoleConfig { baseUrl: string; apiKey: string; model: string }

const local = globalThis as typeof globalThis & {
  timePostOfficeModelOverrides?: Partial<Record<Role, RoleConfig>>;
};

function enabled() {
  return process.env.ENABLE_LOCAL_MODEL_SETTINGS === "1";
}

export function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function canConfigureModels(host: string | null) {
  return enabled() && !!host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export function getLocalModel(role: Role) {
  return enabled() ? local.timePostOfficeModelOverrides?.[role] : undefined;
}

export function setLocalModel(role: Role, config: RoleConfig | null) {
  const overrides = local.timePostOfficeModelOverrides ??= {};
  if (config) overrides[role] = config;
  else delete overrides[role];
}
