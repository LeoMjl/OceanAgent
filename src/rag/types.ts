export interface RagDocument {
  id: string;
  cardType: "dataset" | "problem_solution" | "usage_bundle";
  title: string;
  content: string;
  sourceIds: string[];
  payload: Record<string, unknown>;
  sourcePath: string;
  sourceHash: string;
}

export interface StoredRagDocument extends RagDocument {
  embeddingModel?: string;
  embeddingDimensions?: number;
  embedding?: number[];
  indexedAt: string;
}
