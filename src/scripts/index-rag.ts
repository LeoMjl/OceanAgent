import { loadConfig } from "../config.js";
import { OceanDatabase } from "../db/database.js";
import { ModelSettingsRepository } from "../db/model-settings-repository.js";
import { indexOceanRag } from "../rag/indexer.js";
import { RagStore } from "../rag/rag-store.js";
import { DashScopeEmbeddingClient } from "../rag/embedding-client.js";
import { DpapiSecretProtector } from "../security/dpapi-secret-protector.js";
import { OCEAN_DASHSCOPE_PROVIDER_ID } from "../agent/model-defaults.js";

const config = loadConfig();
const database = new OceanDatabase(config.databasePath);
const settings = new ModelSettingsRepository(database, new DpapiSecretProtector());
const embeddingSettings = settings.getEmbeddingSettings();
const embeddings = new DashScopeEmbeddingClient(
  embeddingSettings,
  () => settings.getApiKey(OCEAN_DASHSCOPE_PROVIDER_ID),
);
const force = process.argv.includes("--force");

try {
  console.log(`Ocean-RAG: ${config.ragRoot}`);
  console.log(`Embedding: ${embeddingSettings.modelId} (${embeddingSettings.dimensions}维)`);
  console.log(`Mode: ${force ? "full rebuild" : "incremental"}`);
  const result = await indexOceanRag(config, new RagStore(database), embeddings, (progress) => {
    console.log(`[${progress.completed}/${progress.total}] ${progress.message}`);
  }, { force });
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
