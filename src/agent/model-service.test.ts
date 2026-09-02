import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OceanDatabase } from "../db/database.js";
import { ModelSettingsRepository } from "../db/model-settings-repository.js";
import type { SecretProtector } from "../security/dpapi-secret-protector.js";
import { OceanModelService, decodeModelReference, encodeModelReference } from "./model-service.js";
import { ProviderModelDiscovery } from "./provider-model-discovery.js";

class TestProtector implements SecretProtector {
  async protect(secret: string): Promise<string> { return `sealed:${secret}`; }
  async unprotect(ciphertext: string): Promise<string> { return ciphertext.slice(7); }
}

describe("OceanModelService", () => {
  let database: OceanDatabase;
  let service: OceanModelService;
  let settings: ModelSettingsRepository;
  let discovery: ProviderModelDiscovery;

  beforeEach(async () => {
    database = new OceanDatabase(":memory:");
    settings = new ModelSettingsRepository(database, new TestProtector());
    const fetcher = async () => new Response(JSON.stringify({ data: [
      { id: "deepseek-chat" }, { id: "deepseek-reasoner" }, { id: "deepseek-next" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
    discovery = new ProviderModelDiscovery(fetcher);
    service = await OceanModelService.create(settings, discovery);
  });

  afterEach(() => database.close());

  it("boots without an implicit model and round-trips model references", () => {
    const state = service.getState();
    expect(state.enabledModels).toEqual([]);
    expect(state.defaultModel).toBeNull();
    expect(state.providers.length).toBeGreaterThan(30);
    const reference = { providerId: "deepseek", modelId: "deepseek-chat" };
    expect(decodeModelReference(encodeModelReference(reference))).toEqual(reference);
  });

  it("discovers, enables, and restores remote provider models", async () => {
    const result = await service.discoverProvider("deepseek", "test-key");
    expect(result.source).toBe("remote");
    const selected = result.models;
    const state = await service.saveProvider("deepseek", selected.map((model) => model.modelId), "test-key");
    expect(state.enabledModels.filter((model) => model.providerId === "deepseek")).toHaveLength(selected.length);
    expect(service.resolveRunModel(selected[0]!.key).id).toBe(selected[0]!.modelId);
    expect(settings.getProvider("deepseek")?.catalog?.source).toBe("remote");

    const restored = await OceanModelService.create(settings, discovery);
    expect(restored.resolveRunModel("deepseek::deepseek-next").id).toBe("deepseek-next");
  });

  it("does not accept environment credentials as a SQLite fallback", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-api-key-not-real";
    try {
      await expect(service.discoverProvider("deepseek")).rejects.toThrow("填写 API Key");
      const modelId = service.listProviderModels("deepseek")[0]!.modelId;
      await expect(service.saveProvider("deepseek", [modelId])).rejects.toThrow("填写");
      expect(service.getState().providers.find((item) => item.id === "deepseek")?.configured).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });

  it("rejects providers that require cloud or OAuth settings", async () => {
    await expect(service.discoverProvider("amazon-bedrock", "test-key")).rejects.toThrow("OAuth");
  });
});
