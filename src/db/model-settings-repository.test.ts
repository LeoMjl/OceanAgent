import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretProtector } from "../security/dpapi-secret-protector.js";
import { OceanDatabase } from "./database.js";
import { ModelSettingsRepository } from "./model-settings-repository.js";

class TestProtector implements SecretProtector {
  async protect(secret: string): Promise<string> {
    return `sealed:${Buffer.from(secret).toString("base64")}`;
  }

  async unprotect(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.slice("sealed:".length), "base64").toString();
  }
}

describe("ModelSettingsRepository", () => {
  let database: OceanDatabase;
  let repository: ModelSettingsRepository;

  beforeEach(() => {
    database = new OceanDatabase(":memory:");
    repository = new ModelSettingsRepository(database, new TestProtector());
  });

  afterEach(() => database.close());

  it("encrypts provider credentials and stores multiple enabled models", async () => {
    await repository.saveProvider("deepseek", ["deepseek-chat", "deepseek-reasoner"], "secret-key");

    expect(repository.getProvider("deepseek")).toMatchObject({
      providerId: "deepseek",
      hasSavedCredential: true,
      enabledModelIds: ["deepseek-chat", "deepseek-reasoner"],
    });
    expect(await repository.getApiKey("deepseek")).toBe("secret-key");
    const row = database.raw.prepare(
      "SELECT secret_ciphertext FROM model_provider_settings WHERE provider_id = ?",
    ).get("deepseek") as { secret_ciphertext: string };
    expect(row.secret_ciphertext).not.toContain("secret-key");
  });

  it("preserves an existing credential while changing models and the default", async () => {
    await repository.saveProvider("openai", ["gpt-5"], "first-key");
    await repository.saveProvider("openai", ["gpt-5", "gpt-5-mini"]);
    repository.setDefaultModel({ providerId: "openai", modelId: "gpt-5-mini" });

    expect(await repository.getApiKey("openai")).toBe("first-key");
    expect(repository.getProvider("openai")?.enabledModelIds).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(repository.getDefaultModel()).toEqual({ providerId: "openai", modelId: "gpt-5-mini" });
  });

  it("persists the embedding model settings in SQLite", () => {
    const settings = repository.getEmbeddingSettings();
    expect(settings).toMatchObject({
      providerId: "dashscope-ocean",
      modelId: "qwen3.7-text-embedding",
      dimensions: 1024,
    });
    const row = database.raw.prepare(
      "SELECT value FROM app_settings WHERE key = 'embedding_model_settings'",
    ).get() as { value: string };
    expect(JSON.parse(row.value)).toMatchObject(settings);
  });
});
