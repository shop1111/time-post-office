/** 可排查的单行日志；不序列化整个异常、请求、提示词或服务商响应。 */
export function errorDetails(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: "UnknownError", message: "Non-Error failure (details omitted)" };
  const name = error.name.replace(/[^\w.-]/g, "").slice(0, 80) || "Error";
  // Prisma 的 message 可能包含调用位置和整段写入参数；JSON 错误可能带模型正文。
  if (name.startsWith("Prisma")) {
    const code = "code" in error && /^P\d{4}$/.test(String(error.code)) ? String(error.code) : "unknown";
    return { name, message: `Database operation failed (${code}); query details omitted` };
  }
  if (error instanceof SyntaxError) return { name, message: "Invalid JSON or syntax; payload omitted" };
  let message = error.message;
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key) && value) message = message.split(value).join("[redacted]");
  }
  message = message.split(/[\r\n]/, 1)[0]
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[\w-]+/g, "[redacted]")
    .replace(/(?:prompt|messages|response|payload|body|content)\s*[=:].*/i, "[content omitted]")
    .replace(/\{.*$/, "[structured details omitted]")
    .slice(0, 240);
  return { name, message: message || "Error details omitted" };
}

export function logError(context: string, error: unknown) {
  const { name, message } = errorDetails(error);
  console.warn(`[${context}] ${name}: ${message}`);
}
