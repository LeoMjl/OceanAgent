export interface CatalogSeedModel {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
}

export interface RemoteCatalogModel {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface RemoteCatalogResult {
  source: "remote" | "pi_catalog";
  models: RemoteCatalogModel[];
  message: string;
}

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function piFallback(seeds: CatalogSeedModel[], detail?: string): RemoteCatalogResult {
  return {
    source: "pi_catalog",
    models: seeds.map((model) => ({ id: model.id, name: model.name })),
    message: detail ?? `该供应商未开放标准远程目录，已加载 ${seeds.length} 个 Pi 内置模型。`,
  };
}

function parseCommon(items: unknown[]): RemoteCatalogModel[] {
  return items.flatMap((item) => {
    const value = record(item);
    const id = text(value.id) ?? text(value.model);
    if (!id) return [];
    const capabilities = record(value.capabilities);
    const thinking = record(capabilities.thinking);
    const modalities = Array.isArray(value.input_modalities) ? value.input_modalities.map(String) : [];
    return [{
      id,
      name: text(value.display_name) ?? text(value.name) ?? id,
      reasoning: thinking.supported === true || value.reasoning === true,
      input: modalities.includes("image") ? ["text", "image"] : ["text"],
      contextWindow: positive(value.context_window) ?? positive(value.max_input_tokens),
      maxTokens: positive(value.max_tokens) ?? positive(value.max_output_tokens),
    } satisfies RemoteCatalogModel];
  });
}

function parseGoogle(payload: unknown): RemoteCatalogModel[] {
  const models = record(payload).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((item) => {
    const value = record(item);
    const methods = Array.isArray(value.supportedGenerationMethods)
      ? value.supportedGenerationMethods.map(String) : [];
    if (methods.length && !methods.includes("generateContent")) return [];
    const id = text(value.baseModelId) ?? text(value.name)?.replace(/^models\//, "");
    if (!id) return [];
    return [{
      id,
      name: text(value.displayName) ?? id,
      reasoning: value.thinking === true,
      input: ["text", "image"],
      contextWindow: positive(value.inputTokenLimit),
      maxTokens: positive(value.outputTokenLimit),
    } satisfies RemoteCatalogModel];
  });
}

function parseDashScope(payload: unknown): RemoteCatalogModel[] {
  const output = record(record(payload).output);
  if (!Array.isArray(output.models)) return [];
  return output.models.flatMap((item) => {
    const value = record(item);
    const id = text(value.model);
    if (!id) return [];
    const info = record(value.model_info);
    const metadata = record(value.inference_metadata);
    const requestModalities = Array.isArray(metadata.request_modality)
      ? metadata.request_modality.map(String) : [];
    const responseModalities = Array.isArray(metadata.response_modality)
      ? metadata.response_modality.map(String) : [];
    if (responseModalities.length && !responseModalities.includes("Text")) return [];
    if (requestModalities.length && !requestModalities.includes("Text")) return [];
    const capabilities = Array.isArray(value.capabilities) ? value.capabilities.map(String) : [];
    return [{
      id,
      name: text(value.name) ?? id,
      reasoning: capabilities.includes("Reasoning"),
      input: requestModalities.includes("Image") ? ["text", "image"] : ["text"],
      contextWindow: positive(info.context_window) ?? positive(info.max_input_tokens),
      maxTokens: positive(info.max_output_tokens) ?? positive(info.reasoning_max_output_tokens),
    } satisfies RemoteCatalogModel];
  });
}

export class ProviderModelDiscovery {
  constructor(private readonly fetcher: FetchLike = fetch, private readonly timeoutMs = 15_000) {}

  async discover(providerId: string, apiKey: string, seeds: CatalogSeedModel[]): Promise<RemoteCatalogResult> {
    const route = this.route(providerId, apiKey, seeds);
    if (!route) return piFallback(seeds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(route.url, {
        headers: route.headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          return piFallback(seeds, `供应商未提供兼容的远程目录，已加载 ${seeds.length} 个 Pi 内置模型。`);
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(`API Key 无效或无权读取模型目录（HTTP ${response.status}）`);
        }
        throw new Error(`读取供应商模型目录失败（HTTP ${response.status}）`);
      }
      const payload = await response.json() as unknown;
      const models = route.format === "google" ? parseGoogle(payload)
        : route.format === "dashscope" ? parseDashScope(payload)
          : parseCommon(Array.isArray(record(payload).data) ? record(payload).data as unknown[] : []);
      const unique = [...new Map(models.map((model) => [model.id, model])).values()];
      if (!unique.length) throw new Error("供应商返回了空模型目录");
      return { source: "remote", models: unique, message: `已从供应商实时读取 ${unique.length} 个模型。` };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("读取模型目录超时，请检查网络后重试");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private route(providerId: string, apiKey: string, seeds: CatalogSeedModel[]): {
    url: string;
    headers: Record<string, string>;
    format: "common" | "google" | "dashscope";
  } | null {
    const openai = seeds.find((model) => model.api.startsWith("openai-"));
    if (providerId === "dashscope-ocean" && seeds[0]) {
      const url = new URL(seeds[0].baseUrl);
      url.pathname = url.pathname.replace(/\/compatible-mode\/v1\/?$/, "/api/v1/models");
      url.search = "capabilities=TG&supports=inference&page_no=1&page_size=1000";
      return { url: url.toString(), headers: { Authorization: `Bearer ${apiKey}` }, format: "dashscope" as const };
    }
    if (providerId === "google" && seeds[0]) {
      const url = new URL(endpoint(seeds[0].baseUrl, "models"));
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", "1000");
      return { url: url.toString(), headers: {}, format: "google" as const };
    }
    if (providerId === "anthropic" && seeds[0]) {
      return { url: endpoint(seeds[0].baseUrl, "v1/models?limit=1000"), headers: {
        "x-api-key": apiKey, "anthropic-version": "2023-06-01",
      }, format: "common" as const };
    }
    if (providerId === "mistral" && seeds[0]) {
      return { url: endpoint(seeds[0].baseUrl, "v1/models"), headers: {
        Authorization: `Bearer ${apiKey}`,
      }, format: "common" as const };
    }
    if (openai) return { url: endpoint(openai.baseUrl, "models"), headers: {
      Authorization: `Bearer ${apiKey}`,
    }, format: "common" as const };
    return null;
  }
}
