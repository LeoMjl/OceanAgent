import { describe, expect, it } from "vitest";
import { OCEAN_DEFAULT_EMBEDDING_SETTINGS } from "../agent/model-defaults.js";
import { DashScopeEmbeddingClient } from "./embedding-client.js";

describe("DashScopeEmbeddingClient", () => {
  it("requires the SQLite credential resolver even when an environment key exists", async () => {
    const previous = process.env.DASHSCOPE_API_KEY;
    process.env.DASHSCOPE_API_KEY = "test-api-key-not-real";
    try {
      const client = new DashScopeEmbeddingClient(
        OCEAN_DEFAULT_EMBEDDING_SETTINGS,
        async () => null,
      );
      await expect(client.embedOne("海表温度")).rejects.toThrow("设置中配置并保存 API Key");
    } finally {
      if (previous === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previous;
    }
  });
});
