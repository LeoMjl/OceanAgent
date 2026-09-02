import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { DashScopeEmbeddingClient } from "./embedding-client.js";
import { loadRagDocuments } from "./normalizer.js";
import { RagStore } from "./rag-store.js";
import { researchFieldLabel } from "./research-fields.js";
import type { RagDocument } from "./types.js";

export interface IndexProgress {
  completed: number;
  total: number;
  message: string;
}

export interface IndexResult {
  discovered: number;
  embedded: number;
  removed: number;
  version: string;
}

export interface IndexOptions {
  force?: boolean;
  signal?: AbortSignal;
}

const CARD_FILES = [
  "dataset_cards.jsonl",
  "problem_solution_cards.jsonl",
  "usage_bundle_cards.jsonl",
];

const EMBEDDING_SCHEMA_VERSION = "typed-cards-v1";

function embeddingText(document: RagDocument): string {
  if (document.cardType === "problem_solution") {
    const field = document.payload.research_field as Record<string, unknown> | undefined;
    const primary = researchFieldLabel(String(field?.primary ?? "unresolved"));
    const secondary = Array.isArray(field?.secondary)
      ? field.secondary.map((code) => researchFieldLabel(String(code))).join("、")
      : "";
    return [
      "Represent this ocean-science research problem and its reported high-level solution.",
      `Primary research field: ${primary}`,
      `Secondary research fields: ${secondary}`,
      document.content,
    ].join("\n");
  }
  if (document.cardType === "dataset") {
    return [
      "Represent this reusable authoritative data product for direct dataset discovery.",
      document.content,
    ].join("\n");
  }
  return [
    "Usage bundles are stored for exact lookup and are not semantic-search documents.",
    `Bundle ID: ${document.id}`,
  ].join("\n");
}

export async function indexOceanRag(
  config: AppConfig,
  store: RagStore,
  client: DashScopeEmbeddingClient,
  onProgress?: (progress: IndexProgress) => void,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const sourcePaths = CARD_FILES.map((name) => join(config.ragRoot, "cards", name));
  const groups = await Promise.all(sourcePaths.map(loadRagDocuments));
  const documents = groups.flat();
  const validIds = new Set(documents.map((document) => document.id));
  const embeddable = documents.filter((document) => document.cardType !== "usage_bundle");
  const embeddingSchemaChanged = store.getMeta("embedding_schema_version") !== EMBEDDING_SCHEMA_VERSION;
  const pending = options.force || embeddingSchemaChanged
    ? embeddable
    : embeddable.filter((document) => store.needsEmbedding(document, client.model, client.dimensions));

  for (const document of documents.filter((item) => item.cardType === "usage_bundle")) {
    store.upsert(document, null);
  }

  let completed = 0;
  for (let offset = 0; offset < pending.length; offset += 20) {
    if (options.signal?.aborted) throw new Error("RAG索引已取消");
    const batch = pending.slice(offset, offset + 20);
    onProgress?.({ completed, total: pending.length, message: `正在嵌入 ${offset + 1}-${offset + batch.length}` });
    const embeddings = await client.embed(batch.map(embeddingText), options.signal);
    batch.forEach((document, index) => {
      const embedding = embeddings[index];
      if (!embedding) throw new Error(`缺少文档 ${document.id} 的向量`);
      store.upsert(document, embedding, client.model, client.dimensions);
    });
    completed += batch.length;
    onProgress?.({ completed, total: pending.length, message: `已嵌入 ${completed}/${pending.length}` });
  }

  const removed = store.removeMissing(validIds, sourcePaths);
  const version = createHash("sha256")
    .update(`${EMBEDDING_SCHEMA_VERSION}\n${documents.map((document) => `${document.id}:${document.sourceHash}`).sort().join("\n")}`)
    .digest("hex")
    .slice(0, 16);
  store.setMeta("index_version", version);
  store.setMeta("embedding_model", client.model);
  store.setMeta("embedding_dimensions", String(client.dimensions));
  store.setMeta("embedding_schema_version", EMBEDDING_SCHEMA_VERSION);
  store.setMeta("indexed_at", new Date().toISOString());

  return { discovered: documents.length, embedded: pending.length, removed, version };
}
