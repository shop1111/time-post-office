import { afterEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/settings/models/route";
import { embed, providerStatus } from "@/lib/ai/provider";

const localOrigin = "http://localhost:3000";

function update(body: unknown, origin = localOrigin, host = "localhost:3000") {
  return PUT(new Request(`${localOrigin}/api/settings/models`, {
    method: "PUT",
    headers: { host, origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("local model settings", () => {
  afterEach(async () => {
    await update({ action: "reset", role: "embed" });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts changes only from the enabled local settings page", async () => {
    const reset = { action: "reset", role: "chat" };
    vi.stubEnv("ENABLE_LOCAL_MODEL_SETTINGS", "0");
    expect((await update(reset)).status).toBe(404);
    vi.stubEnv("ENABLE_LOCAL_MODEL_SETTINGS", "1");
    expect((await update(reset, "https://example.com", "example.com")).status).toBe(404);
    expect((await update(reset, "https://example.com")).status).toBe(403);
    expect((await update({
      action: "save", role: "chat", baseUrl: "http://example.com/v1", model: "example", apiKey: "test-key",
    })).status).toBe(400);
  });

  it("uses an embedding override immediately in lite mode and restores the default on reset", async () => {
    vi.stubEnv("ENABLE_LOCAL_MODEL_SETTINGS", "1");
    vi.stubEnv("EMBED_MODE", "lite");
    const save = await update({
      action: "save", role: "embed", baseUrl: "http://127.0.0.1:4567/v1/", model: "test-embed", apiKey: "test-key",
    });
    expect(save.status).toBe(204);
    expect(await save.text()).toBe("");
    expect(providerStatus().embed).toBe("test-embed");

    const fetchMock = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [3, 4] }] }));
    vi.stubGlobal("fetch", fetchMock);
    const [vector] = await embed(["测试"]);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4567/v1/embeddings", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      body: JSON.stringify({ model: "test-embed", input: ["测试"] }),
    }));

    expect((await update({ action: "reset", role: "embed" })).status).toBe(204);
    await embed(["测试"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
