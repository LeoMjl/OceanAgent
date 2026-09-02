import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  OCEAN_DASHSCOPE_BASE_URL,
  OCEAN_DASHSCOPE_PROVIDER_ID,
  OCEAN_DASHSCOPE_PROVIDER_NAME,
  OCEAN_DEFAULT_CHAT_MODEL,
} from "./model-defaults.js";

type ModelRuntimeOptions = NonNullable<Parameters<typeof ModelRuntime.create>[0]>;
type CredentialStore = NonNullable<ModelRuntimeOptions["credentials"]>;

function sqliteOnlyCredentialStore(): CredentialStore {
  return {
    async read(_providerId, options) {
      options?.signal?.throwIfAborted();
      return undefined;
    },
    async list(options) {
      options?.signal?.throwIfAborted();
      return [];
    },
    async modify(_providerId, update, options) {
      options?.signal?.throwIfAborted();
      return update(undefined);
    },
    async delete(_providerId, options) {
      options?.signal?.throwIfAborted();
    },
  };
}

export async function createOceanModelRuntime() {
  const runtime = await ModelRuntime.create({
    credentials: sqliteOnlyCredentialStore(),
    allowModelNetwork: false,
    refreshOnCreate: false,
    modelsPath: null,
  });
  runtime.registerProvider(OCEAN_DASHSCOPE_PROVIDER_ID, {
    name: OCEAN_DASHSCOPE_PROVIDER_NAME,
    baseUrl: OCEAN_DASHSCOPE_BASE_URL,
    api: "openai-completions",
    models: [{
      id: OCEAN_DEFAULT_CHAT_MODEL,
      name: OCEAN_DEFAULT_CHAT_MODEL,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 65_536,
      compat: {
        thinkingFormat: "qwen",
        supportsDeveloperRole: false,
        supportsStore: false,
        supportsReasoningEffort: false,
      },
    }],
  });
  const model = runtime.getModel(OCEAN_DASHSCOPE_PROVIDER_ID, OCEAN_DEFAULT_CHAT_MODEL);
  if (!model) throw new Error(`无法注册对话模型：${OCEAN_DEFAULT_CHAT_MODEL}`);
  return { runtime, model };
}
