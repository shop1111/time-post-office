import { afterEach, expect, it, vi } from "vitest";
import { errorDetails, logError } from "@/lib/errors";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("日志保留错误类型与可排查消息，省略凭据和后续正文", () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  logError("postman.generate", new TypeError("connection failed Bearer test-only-placeholder\n完整提示词与服务商响应"));
  expect(warn).toHaveBeenCalledExactlyOnceWith("[postman.generate] TypeError: connection failed Bearer [redacted]");
  expect(errorDetails(new Error('request failed response={"content":"私人日记"}')).message).not.toContain("私人日记");
});
it("Prisma/JSON异常不把参数或模型输出带入日志", () => {
  const prisma = Object.assign(new Error("Invalid create: 私人日记"), { name: "PrismaClientKnownRequestError", code: "P2002" });
  expect(errorDetails(prisma)).toEqual({ name: prisma.name, message: "Database operation failed (P2002); query details omitted" });
  expect(errorDetails(new SyntaxError("Unexpected token in 私人日记")).message).not.toContain("私人日记");
});
