import type { EmbeddingModelSettings } from "../agent/model-defaults.js";

interface EmbeddingResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  error?: { message?: string; code?: string };
}

export class DashScopeEmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(
    settings: EmbeddingModelSettings,
    private readonly resolveApiKey: () => Promise<string | null>,
  ) {
    this.model = settings.modelId;
    this.dimensions = settings.dimensions;
    this.baseUrl = settings.baseUrl.replace(/\/$/, "");
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0) return [];
    if (inputs.length > 20) throw new Error("qwen3.7-text-embedding 单批最多20条文本");
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error("知识库检索需要阿里云百炼模型，请先在设置中配置并保存 API Key");
    }
    const timeout = AbortSignal.timeout(120_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
        encoding_format: "float",
      }),
      signal: combined,
    });

    const payload = await response.json() as EmbeddingResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `DashScope Embedding请求失败：HTTP ${response.status}`);
    }
    const ordered = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);
    if (ordered.length !== inputs.length) throw new Error("DashScope返回的向量数量与输入不一致");
    for (const item of ordered) {
      if (item.embedding.length !== this.dimensions) {
        throw new Error(`向量维度异常：期望${this.dimensions}，实际${item.embedding.length}`);
      }
    }
    return ordered.map((item) => item.embedding);
  }

  async embedOne(input: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embed([input], signal);
    if (!embedding) throw new Error("Embedding响应为空");
    return embedding;
  }
}
