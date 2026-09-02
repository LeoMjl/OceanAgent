import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  ConfiguredModel, ModelDiscoveryResult, ModelProviderSummary, ModelReference, ModelSettingsState,
} from "../contracts.js";
import {
  ModelSettingsRepository, type StoredCatalogModel, type StoredModelCatalog,
} from "../db/model-settings-repository.js";
import { createOceanModelRuntime } from "./model.js";
import {
  ProviderModelDiscovery, type RemoteCatalogModel,
} from "./provider-model-discovery.js";

type RuntimeModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];
type RuntimeModelConfig = NonNullable<ProviderConfigInput["models"]>[number];

const NON_CHAT_MODEL = /(embedding|embed-|whisper|transcri|speech|tts|audio|dall-e|image|moderation|rerank|realtime)/i;

const ADVANCED_PROVIDERS = new Set([
  "amazon-bedrock",
  "azure-openai-responses",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "google-vertex",
  "github-copilot",
  "openai-codex",
]);

const KEY_LABELS: Record<string, string> = {
  anthropic: "Anthropic API Key",
  openai: "OpenAI API Key",
  google: "Gemini API Key",
  deepseek: "DeepSeek API Key",
  openrouter: "OpenRouter API Key",
  huggingface: "Hugging Face Token",
  "dashscope-ocean": "阿里云百炼 API Key",
};

export function encodeModelReference(model: ModelReference): string {
  return `${model.providerId}::${model.modelId}`;
}

export function decodeModelReference(value: string): ModelReference | null {
  const separator = value.indexOf("::");
  if (separator < 1) return null;
  const providerId = value.slice(0, separator);
  const modelId = value.slice(separator + 2);
  return modelId ? { providerId, modelId } : null;
}

function modelView(model: RuntimeModel, providerName: string): ConfiguredModel {
  return {
    key: encodeModelReference({ providerId: model.provider, modelId: model.id }),
    providerId: model.provider,
    modelId: model.id,
    providerName,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    input: [...model.input],
  };
}

function storedModel(model: RuntimeModel): StoredCatalogModel {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    samplingParams: model.samplingParams ? { ...model.samplingParams } : undefined,
    headers: model.headers ? { ...model.headers } : undefined,
    compat: model.compat,
  };
}

export class OceanModelService {
  private readonly pendingCatalogs = new Map<string, StoredModelCatalog>();

  private constructor(
    private readonly settings: ModelSettingsRepository,
    readonly runtime: ModelRuntime,
    private readonly discovery: ProviderModelDiscovery,
  ) {}

  static async create(
    settings: ModelSettingsRepository,
    discovery = new ProviderModelDiscovery(),
  ): Promise<OceanModelService> {
    const { runtime } = await createOceanModelRuntime();
    const service = new OceanModelService(settings, runtime, discovery);
    for (const stored of settings.listProviders()) {
      if (stored.catalog?.source === "remote" && stored.catalog.models.length) {
        service.registerCatalog(stored.providerId, stored.catalog.models);
      }
      const apiKey = await settings.getApiKey(stored.providerId);
      if (apiKey && runtime.getProvider(stored.providerId)) {
        await runtime.setRuntimeApiKey(stored.providerId, apiKey);
      }
    }
    return service;
  }

  listProviderModels(providerId: string): ConfiguredModel[] {
    const provider = this.runtime.getProvider(providerId);
    if (!provider) throw new Error("模型供应商不存在");
    return this.runtime.getModels(providerId).map((model) => modelView(model, provider.name));
  }

  async discoverProvider(providerId: string, apiKey?: string): Promise<ModelDiscoveryResult> {
    const provider = this.runtime.getProvider(providerId);
    if (!provider) throw new Error("Pi SDK 中不存在该模型供应商");
    if (ADVANCED_PROVIDERS.has(providerId)) {
      throw new Error("该供应商还需要云账号、区域或 OAuth 配置，暂不能只通过 API Key 接入");
    }
    const suppliedKey = apiKey?.trim();
    const savedKey = suppliedKey ? null : await this.settings.getApiKey(providerId);
    const resolvedKey = suppliedKey || savedKey;
    if (!resolvedKey) throw new Error("请先填写 API Key");
    const seeds = this.runtime.getModels(providerId).map((model) => ({
      id: model.id, name: model.name, api: model.api, baseUrl: model.baseUrl,
    }));
    const result = await this.discovery.discover(providerId, resolvedKey, seeds);
    const discoveredAt = new Date().toISOString();
    let catalogModels = this.runtime.getModels(providerId).map(storedModel);
    if (result.source === "remote") {
      catalogModels = this.composeRemoteCatalog(providerId, result.models);
      this.registerCatalog(providerId, catalogModels);
    }
    const catalog: StoredModelCatalog = { source: result.source, discoveredAt, models: catalogModels };
    this.pendingCatalogs.set(providerId, catalog);
    if (suppliedKey) await this.runtime.setRuntimeApiKey(providerId, suppliedKey);
    return {
      providerId,
      models: this.listProviderModels(providerId),
      source: result.source,
      message: result.message,
      discoveredAt,
    };
  }

  async saveProvider(providerId: string, modelIds: string[], apiKey?: string): Promise<ModelSettingsState> {
    if (ADVANCED_PROVIDERS.has(providerId)) throw new Error("该供应商当前需要高级认证配置");
    if (!modelIds.length) throw new Error("请至少选择一个模型");
    const available = new Set(this.runtime.getModels(providerId).map((model) => model.id));
    if (!available.size) throw new Error("模型供应商不存在或没有可用模型");
    if (modelIds.some((id) => !available.has(id))) throw new Error("选择中包含无效模型");
    const existing = this.settings.getProvider(providerId);
    const hasCredential = Boolean(apiKey?.trim()) || existing?.hasSavedCredential;
    if (!hasCredential) throw new Error("请填写该供应商的 API Key");
    if (apiKey?.trim()) await this.runtime.setRuntimeApiKey(providerId, apiKey.trim());
    const catalog = this.pendingCatalogs.get(providerId) ?? existing?.catalog ?? undefined;
    await this.settings.saveProvider(providerId, [...new Set(modelIds)], apiKey?.trim(), catalog);
    const enabledKeys = new Set(this.enabledModels().map((model) => model.key));
    const current = this.settings.getDefaultModel();
    if (!current || !enabledKeys.has(encodeModelReference(current))) {
      this.settings.setDefaultModel({ providerId, modelId: modelIds[0]! });
    }
    return this.getState();
  }

  setDefaultModel(model: ModelReference): ModelSettingsState {
    const key = encodeModelReference(model);
    if (!this.enabledModels().some((item) => item.key === key)) {
      throw new Error("该模型尚未在设置中启用");
    }
    this.settings.setDefaultModel(model);
    return this.getState();
  }

  runModelValue(model?: ModelReference): string {
    const selected = model ?? this.getState().defaultModel;
    if (!selected) throw new Error("尚未配置模型，请先打开设置添加模型供应商");
    const key = encodeModelReference(selected);
    if (!this.enabledModels().some((item) => item.key === key)) {
      throw new Error("所选模型尚未启用，请在设置中重新选择");
    }
    return key;
  }

  enabledModels(): ConfiguredModel[] {
    return this.settings.listProviders().flatMap((setting) => {
      if (!setting.hasSavedCredential) return [];
      const provider = this.runtime.getProvider(setting.providerId);
      if (!provider) return [];
      const enabled = new Set(setting.enabledModelIds);
      return this.runtime.getModels(setting.providerId)
        .filter((model) => enabled.has(model.id))
        .map((model) => modelView(model, provider.name));
    });
  }

  getState(): ModelSettingsState {
    const stored = new Map(this.settings.listProviders().map((item) => [item.providerId, item]));
    const enabledModels = this.enabledModels();
    const enabledKeys = new Set(enabledModels.map((model) => model.key));
    const savedDefault = this.settings.getDefaultModel();
    const defaultModel = savedDefault && enabledKeys.has(encodeModelReference(savedDefault))
      ? savedDefault
      : enabledModels[0]
        ? { providerId: enabledModels[0].providerId, modelId: enabledModels[0].modelId }
        : null;
    const providers: ModelProviderSummary[] = this.runtime.getProviders()
      .filter((provider) => this.runtime.getModels(provider.id).length > 0)
      .map((provider) => {
        const saved = stored.get(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          modelCount: this.runtime.getModels(provider.id).length,
          configured: Boolean(saved?.hasSavedCredential && saved.enabledModelIds.length),
          enabledModelIds: saved?.hasSavedCredential ? saved.enabledModelIds : [],
          configurationMode: ADVANCED_PROVIDERS.has(provider.id) ? "advanced" : "api_key",
          keyLabel: KEY_LABELS[provider.id] ?? "API Key",
          credentialSource: saved?.hasSavedCredential ? "saved" : undefined,
        };
      });
    return {
      providers,
      enabledModels,
      defaultModel,
    };
  }

  resolveRunModel(value?: string): RuntimeModel {
    const reference = value ? decodeModelReference(value) : null;
    const selected = reference ?? this.getState().defaultModel;
    if (!selected) throw new Error("尚未配置模型，请先打开设置添加模型供应商");
    const selectedKey = encodeModelReference(selected);
    if (!this.enabledModels().some((item) => item.key === selectedKey)) {
      throw new Error("所选模型尚未启用，请在设置中重新选择");
    }
    const model = selected ? this.runtime.getModel(selected.providerId, selected.modelId) : undefined;
    if (!model) throw new Error("所选模型不存在，请在设置中重新选择");
    return model;
  }

  private composeRemoteCatalog(providerId: string, discovered: RemoteCatalogModel[]): StoredCatalogModel[] {
    const current = this.runtime.getModels(providerId);
    const known = new Map(current.map((model) => [model.id, model]));
    const template = current.find((model) => model.api.startsWith("openai-")) ?? current[0];
    if (!template) throw new Error("Pi SDK 中没有可用于动态注册的模型协议模板");
    return discovered
      .filter((model) => known.has(model.id) || !NON_CHAT_MODEL.test(`${model.id} ${model.name}`))
      .map((model) => {
        const existing = known.get(model.id);
        if (existing) return storedModel(existing);
        return {
          id: model.id,
          name: model.name,
          api: template.api,
          baseUrl: template.baseUrl,
          reasoning: model.reasoning ?? false,
          input: model.input ?? ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow ?? 128_000,
          maxTokens: model.maxTokens ?? 16_384,
          compat: template.compat,
        } satisfies StoredCatalogModel;
      });
  }

  private registerCatalog(providerId: string, models: StoredCatalogModel[]): void {
    const registered = this.runtime.getRegisteredProviderConfig(providerId);
    this.runtime.registerProvider(providerId, {
      ...registered,
      models: models as RuntimeModelConfig[],
    });
  }
}
