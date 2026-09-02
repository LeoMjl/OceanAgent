import type { RagSearchResult } from "../contracts.js";
import { OceanDatabase } from "../db/database.js";
import type { RagDocument } from "./types.js";

type Row = Record<string, unknown>;

export interface RagSearchOptions {
  cardType: "dataset" | "problem_solution";
  researchFields?: string[];
  includeUnresolved?: boolean;
  limit?: number;
}

function vectorToBuffer(vector: number[]): Buffer {
  const values = Float32Array.from(vector);
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function bufferToVector(value: unknown): Float32Array {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(copy);
}

function cosineSimilarity(left: number[], right: Float32Array): number {
  if (left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

function ftsExpression(query: string): string {
  const tokens = query.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  return tokens.slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

function mapResult(row: Row, score: number): RagSearchResult {
  const content = String(row.content);
  return {
    id: String(row.id),
    cardType: String(row.card_type) as RagSearchResult["cardType"],
    title: String(row.title),
    excerpt: content.slice(0, 900),
    sourceIds: JSON.parse(String(row.source_ids_json)) as string[],
    score,
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
  };
}

function matchesResearchField(row: Row, fields: string[], includeUnresolved: boolean): boolean {
  if (fields.length === 0) return true;
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  const field = payload.research_field as Record<string, unknown> | undefined;
  const primary = String(field?.primary ?? "unresolved");
  const secondary = Array.isArray(field?.secondary) ? field.secondary.map(String) : [];
  return fields.includes(primary)
    || secondary.some((code) => fields.includes(code))
    || (includeUnresolved && primary === "unresolved");
}

export class RagStore {
  constructor(private readonly db: OceanDatabase) {}

  count(): number {
    const row = this.db.raw.prepare("SELECT COUNT(*) AS count FROM rag_documents").get() as { count: number };
    return Number(row.count);
  }

  needsEmbedding(document: RagDocument, model: string, dimensions: number): boolean {
    const row = this.db.raw.prepare(`
      SELECT source_hash, embedding_model, embedding_dimensions, embedding IS NOT NULL AS has_embedding
      FROM rag_documents WHERE id = ?
    `).get(document.id) as Row | undefined;
    return !row
      || String(row.source_hash) !== document.sourceHash
      || String(row.embedding_model) !== model
      || Number(row.embedding_dimensions) !== dimensions
      || Number(row.has_embedding) !== 1;
  }

  upsert(document: RagDocument, embedding: number[] | null, model?: string, dimensions?: number): void {
    const indexedAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO rag_documents
          (id, card_type, title, content, source_ids_json, payload_json, source_path, source_hash,
           embedding_model, embedding_dimensions, embedding, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          card_type=excluded.card_type, title=excluded.title, content=excluded.content,
          source_ids_json=excluded.source_ids_json, payload_json=excluded.payload_json,
          source_path=excluded.source_path, source_hash=excluded.source_hash,
          embedding_model=excluded.embedding_model, embedding_dimensions=excluded.embedding_dimensions,
          embedding=excluded.embedding, indexed_at=excluded.indexed_at
      `).run(
        document.id,
        document.cardType,
        document.title,
        document.content,
        JSON.stringify(document.sourceIds),
        JSON.stringify(document.payload),
        document.sourcePath,
        document.sourceHash,
        model ?? null,
        dimensions ?? null,
        embedding ? vectorToBuffer(embedding) : null,
        indexedAt,
      );
      this.db.raw.prepare("DELETE FROM rag_fts WHERE id = ?").run(document.id);
      if (document.cardType !== "usage_bundle") {
        this.db.raw.prepare(
          "INSERT INTO rag_fts (id, title, content, source_ids) VALUES (?, ?, ?, ?)",
        ).run(document.id, document.title, document.content, document.sourceIds.join(" "));
      }
    });
  }

  getDocument(id: string, cardType?: RagDocument["cardType"]): RagDocument | null {
    const row = cardType
      ? this.db.raw.prepare("SELECT * FROM rag_documents WHERE id = ? AND card_type = ?").get(id, cardType) as Row | undefined
      : this.db.raw.prepare("SELECT * FROM rag_documents WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      cardType: String(row.card_type) as RagDocument["cardType"],
      title: String(row.title),
      content: String(row.content),
      sourceIds: JSON.parse(String(row.source_ids_json)) as string[],
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      sourcePath: String(row.source_path),
      sourceHash: String(row.source_hash),
    };
  }

  countByType(cardType: RagDocument["cardType"]): number {
    const row = this.db.raw.prepare(
      "SELECT COUNT(*) AS count FROM rag_documents WHERE card_type = ?",
    ).get(cardType) as { count: number };
    return Number(row.count);
  }

  removeMissing(validIds: Set<string>, sourcePaths: string[]): number {
    if (sourcePaths.length === 0) return 0;
    const placeholders = sourcePaths.map(() => "?").join(",");
    const rows = this.db.raw.prepare(
      `SELECT id FROM rag_documents WHERE source_path IN (${placeholders})`,
    ).all(...sourcePaths) as Array<{ id: string }>;
    const stale = rows.map((row) => row.id).filter((id) => !validIds.has(id));
    this.db.transaction(() => {
      const removeFts = this.db.raw.prepare("DELETE FROM rag_fts WHERE id = ?");
      const removeDocument = this.db.raw.prepare("DELETE FROM rag_documents WHERE id = ?");
      for (const id of stale) {
        removeFts.run(id);
        removeDocument.run(id);
      }
    });
    return stale.length;
  }

  setMeta(key: string, value: string): void {
    this.db.raw.prepare(`
      INSERT INTO rag_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.raw.prepare("SELECT value FROM rag_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  search(
    query: string,
    queryEmbedding: number[],
    model: string,
    dimensions: number,
    options: RagSearchOptions,
  ): RagSearchResult[] {
    const fields = options.researchFields ?? [];
    const includeUnresolved = options.includeUnresolved ?? false;
    const limit = options.limit ?? 8;
    const keywordRows = this.keywordSearch(query, options.cardType, 60)
      .filter((row) => options.cardType !== "problem_solution"
        || matchesResearchField(row, fields, includeUnresolved));
    const vectorRows = this.db.raw.prepare(`
      SELECT * FROM rag_documents
      WHERE card_type = ? AND embedding_model = ? AND embedding_dimensions = ? AND embedding IS NOT NULL
    `).all(options.cardType, model, dimensions) as Row[];
    const vectorScored = vectorRows
      .filter((row) => options.cardType !== "problem_solution"
        || matchesResearchField(row, fields, includeUnresolved))
      .map((row) => ({ row, similarity: cosineSimilarity(queryEmbedding, bufferToVector(row.embedding)) }))
      .sort((a, b) => b.similarity - a.similarity);
    const topSimilarity = vectorScored[0]?.similarity ?? -1;
    if (topSimilarity < 0.58) return [];
    const minimumSimilarity = Math.max(0.58, topSimilarity - 0.16);
    const vectorRanked = vectorScored.slice(0, 40);
    const similarities = new Map(vectorScored.map((item) => [String(item.row.id), item.similarity]));

    const scores = new Map<string, { row: Row; score: number; similarity: number }>();
    keywordRows.forEach((row, index) => {
      const similarity = similarities.get(String(row.id)) ?? -1;
      scores.set(String(row.id), { row, score: 1 / (60 + index), similarity });
    });
    vectorRanked.forEach(({ row, similarity }, index) => {
      const id = String(row.id);
      const current = scores.get(id);
      scores.set(id, { row, score: (current?.score ?? 0) + 1.4 / (60 + index), similarity });
    });
    return [...scores.values()]
      .filter((item) => item.similarity >= minimumSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, similarity }) => mapResult(row, similarity));
  }

  private keywordSearch(query: string, cardType: RagSearchOptions["cardType"], limit: number): Row[] {
    const expression = ftsExpression(query);
    if (!expression) return [];
    try {
      return this.db.raw.prepare(`
        SELECT d.*, bm25(rag_fts) AS keyword_rank
        FROM rag_fts JOIN rag_documents d ON d.id = rag_fts.id
        WHERE rag_fts MATCH ? AND d.card_type = ? ORDER BY keyword_rank LIMIT ?
      `).all(expression, cardType, limit) as Row[];
    } catch {
      return this.db.raw.prepare(`
        SELECT * FROM rag_documents
        WHERE card_type = ? AND (title LIKE ? OR content LIKE ?) LIMIT ?
      `).all(cardType, `%${query}%`, `%${query}%`, limit) as Row[];
    }
  }
}
