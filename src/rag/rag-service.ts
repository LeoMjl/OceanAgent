import type { RagSearchResult } from "../contracts.js";
import type { EmbeddingModelSettings } from "../agent/model-defaults.js";
import { DashScopeEmbeddingClient } from "./embedding-client.js";
import { RagStore } from "./rag-store.js";
import type { ResearchFieldCode } from "./research-fields.js";
import type { RagDocument } from "./types.js";

export type FieldConfidence = "high" | "medium" | "low";

export interface ExpandedResearchCase {
  problem: RagDocument;
  bundle: RagDocument;
  datasetIds: string[];
}

function datasetIdsFromBundle(bundle: RagDocument): string[] {
  const usages = Array.isArray(bundle.payload.data_usages) ? bundle.payload.data_usages : [];
  return [...new Set(usages.flatMap((usage) => {
    if (!usage || typeof usage !== "object") return [];
    const id = (usage as Record<string, unknown>).dataset_id;
    return typeof id === "string" && id ? [id] : [];
  }))];
}

export class RagService {
  private readonly embeddings: DashScopeEmbeddingClient;

  constructor(
    private readonly store: RagStore,
    settings: EmbeddingModelSettings,
    resolveApiKey: () => Promise<string | null>,
    private readonly hasCredential: () => boolean,
  ) {
    this.embeddings = new DashScopeEmbeddingClient(settings, resolveApiKey);
  }

  getStatus(): Record<string, string | number | boolean | null> {
    return {
      documents: this.store.count(),
      problemCards: this.store.countByType("problem_solution"),
      usageBundles: this.store.countByType("usage_bundle"),
      datasetCards: this.store.countByType("dataset"),
      version: this.store.getMeta("index_version"),
      indexedAt: this.store.getMeta("indexed_at"),
      embeddingModel: this.store.getMeta("embedding_model") ?? this.embeddings.model,
      embeddingDimensions: Number(this.store.getMeta("embedding_dimensions") ?? this.embeddings.dimensions),
      credentialConfigured: this.hasCredential(),
    };
  }

  async searchResearchCases(
    query: string,
    researchFields: ResearchFieldCode[],
    fieldConfidence: FieldConfidence,
    limit = 5,
    signal?: AbortSignal,
  ): Promise<RagSearchResult[]> {
    this.ensureIndexed("problem_solution");
    const queryEmbedding = await this.embeddings.embedOne(
      `Retrieve a closely analogous ocean-science research problem and solution for this query:\n${query}`,
      signal,
    );
    return this.store.search(query, queryEmbedding, this.embeddings.model, this.embeddings.dimensions, {
      cardType: "problem_solution",
      researchFields: fieldConfidence === "low" ? [] : researchFields,
      includeUnresolved: fieldConfidence === "medium",
      limit: Math.min(Math.max(limit, 1), 6),
    });
  }

  async searchDatasets(query: string, limit = 5, signal?: AbortSignal): Promise<RagSearchResult[]> {
    this.ensureIndexed("dataset");
    const queryEmbedding = await this.embeddings.embedOne(
      `Retrieve reusable authoritative data products matching this explicit ocean-data requirement:\n${query}`,
      signal,
    );
    return this.store.search(query, queryEmbedding, this.embeddings.model, this.embeddings.dimensions, {
      cardType: "dataset",
      limit: Math.min(Math.max(limit, 1), 6),
    });
  }

  expandResearchCase(cardId: string): ExpandedResearchCase {
    const problem = this.store.getDocument(cardId, "problem_solution");
    if (!problem) throw new Error(`未找到问题方案卡：${cardId}`);
    const bundleId = problem.payload.bundle_id;
    if (typeof bundleId !== "string" || !bundleId) throw new Error(`问题方案卡 ${cardId} 缺少 bundle_id`);
    const bundle = this.store.getDocument(bundleId, "usage_bundle");
    if (!bundle) throw new Error(`未找到问题方案卡关联的数据包：${bundleId}`);
    return { problem, bundle, datasetIds: datasetIdsFromBundle(bundle) };
  }

  getDatasetCards(datasetIds: string[]): RagDocument[] {
    return [...new Set(datasetIds)].flatMap((id) => {
      const document = this.store.getDocument(id, "dataset");
      return document ? [document] : [];
    });
  }

  private ensureIndexed(cardType: RagDocument["cardType"]): void {
    if (this.store.countByType(cardType) === 0) {
      throw new Error("Ocean-RAG索引为空或缺少对应卡片，请先运行 npm run index:rag:rebuild");
    }
  }
}
