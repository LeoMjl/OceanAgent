import { describe, expect, it, vi } from "vitest";
import { ProviderModelDiscovery } from "./provider-model-discovery.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ProviderModelDiscovery", () => {
  it("reads and normalizes the Alibaba Cloud Model Studio catalog", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ output: { models: [{
      model: "qwen3-max",
      name: "Qwen3-Max",
      capabilities: ["TG", "Reasoning"],
      inference_metadata: { request_modality: ["Text", "Image"] },
      model_info: { context_window: 131072, max_output_tokens: 16384 },
    }] } })) as unknown as typeof fetch;
    const discovery = new ProviderModelDiscovery(fetcher);

    const result = await discovery.discover("dashscope-ocean", "secret", [{
      id: "qwen3.7-plus", name: "qwen3.7-plus", api: "openai-completions",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }]);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("dashscope.aliyuncs.com/api/v1/models"),
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    );
    expect(result).toMatchObject({ source: "remote", models: [{
      id: "qwen3-max", reasoning: true, input: ["text", "image"], contextWindow: 131072,
    }] });
  });

  it("uses the OpenAI-compatible models endpoint for compatible providers", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [
      { id: "model-a", owned_by: "vendor" },
      { id: "model-b", name: "Model B", context_window: 64000 },
    ] })) as unknown as typeof fetch;
    const discovery = new ProviderModelDiscovery(fetcher);

    const result = await discovery.discover("groq", "groq-key", [{
      id: "seed", name: "Seed", api: "openai-completions",
      baseUrl: "https://api.groq.com/openai/v1",
    }]);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer groq-key" } }),
    );
    expect(result.models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
  });

  it("normalizes Gemini model metadata and excludes non-generation entries", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ models: [
      { name: "models/gemini-pro", displayName: "Gemini Pro", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1000000 },
      { name: "models/text-embedding", supportedGenerationMethods: ["embedContent"] },
    ] })) as unknown as typeof fetch;
    const discovery = new ProviderModelDiscovery(fetcher);

    const result = await discovery.discover("google", "gemini-key", [{
      id: "seed", name: "Seed", api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    }]);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ id: "gemini-pro", name: "Gemini Pro", contextWindow: 1000000 });
  });

  it("falls back explicitly when a provider has no standard remote catalog", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const discovery = new ProviderModelDiscovery(fetcher);
    const result = await discovery.discover("minimax", "key", [{
      id: "minimax-m2", name: "MiniMax M2", api: "anthropic-messages",
      baseUrl: "https://api.minimax.io/anthropic",
    }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: "pi_catalog", models: [{ id: "minimax-m2" }] });
  });

  it("reports invalid credentials instead of silently falling back", async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 401)) as unknown as typeof fetch;
    const discovery = new ProviderModelDiscovery(fetcher);
    await expect(discovery.discover("openai", "bad", [{
      id: "gpt", name: "GPT", api: "openai-responses", baseUrl: "https://api.openai.com/v1",
    }])).rejects.toThrow("API Key 无效");
  });
});
