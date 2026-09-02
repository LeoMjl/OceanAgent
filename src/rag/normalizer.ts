import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { researchFieldLabel } from "./research-fields.js";
import type { RagDocument } from "./types.js";

const MAX_CONTENT_CHARS = 18_000;

function collectStrings(value: unknown, output: string[], seen: Set<string>): void {
  if (output.join("\n").length >= MAX_CONTENT_CHARS) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      output.push(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, seen);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStrings(nested, output, seen);
    }
  }
}

function collectIds(value: unknown, output: Set<string>, key = ""): void {
  if (typeof value === "string" && /(^|_)id$/.test(key) && value.trim()) output.add(value.trim());
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, output, key);
  } else if (value && typeof value === "object") {
    for (const [nestedKey, nested] of Object.entries(value as Record<string, unknown>)) {
      collectIds(nested, output, nestedKey);
    }
  }
}

function cardTypeFor(filePath: string): RagDocument["cardType"] {
  const name = basename(filePath);
  if (name.startsWith("dataset_")) return "dataset";
  if (name.startsWith("problem_solution_")) return "problem_solution";
  return "usage_bundle";
}

function titleFor(cardType: RagDocument["cardType"], payload: Record<string, unknown>): string {
  if (cardType === "dataset") return String(payload.name ?? payload.dataset_id ?? "未命名数据集");
  if (cardType === "problem_solution") return String(payload.problem ?? payload.card_id ?? "问题-方案卡片");
  const usageIds = Array.isArray(payload.data_usages)
    ? payload.data_usages.map((item) => String((item as Record<string, unknown>).dataset_id ?? "")).filter(Boolean)
    : [];
  return usageIds.length > 0 ? `数据使用流程：${usageIds.slice(0, 4).join("、")}` : String(payload.bundle_id ?? "数据使用流程");
}

function indexedContent(
  cardType: RagDocument["cardType"],
  payload: Record<string, unknown>,
  flattened: string,
): string {
  if (cardType === "problem_solution") {
    const field = payload.research_field as Record<string, unknown> | undefined;
    const secondary = Array.isArray(field?.secondary) ? field.secondary.map(String) : [];
    return [
      `主研究领域 ${researchFieldLabel(String(field?.primary ?? "unresolved"))}`,
      `辅助研究领域 ${secondary.map(researchFieldLabel).join("、")}`,
      `研究问题 ${String(payload.problem ?? "")}`,
      `总体方案 ${String(payload.solution_summary ?? "")}`,
    ].join("\n").slice(0, MAX_CONTENT_CHARS);
  }
  if (cardType === "dataset") {
    return [
      `官方名称 ${String(payload.name ?? "")}`,
      `别名 ${JSON.stringify(payload.aliases ?? [])}`,
      `提供方 ${String(payload.provider ?? "")}`,
      `产品ID ${String(payload.product_id ?? "")}`,
      `版本 ${JSON.stringify(payload.version ?? null)}`,
      `描述 ${String(payload.description ?? "")}`,
      `完整覆盖 ${JSON.stringify(payload.coverage ?? null)}`,
      `原生分辨率 ${JSON.stringify(payload.resolution ?? null)}`,
      `官方字段 ${JSON.stringify(payload.fields ?? [])}`,
    ].join("\n").slice(0, MAX_CONTENT_CHARS);
  }
  return flattened.slice(0, MAX_CONTENT_CHARS);
}

export async function loadRagDocuments(filePath: string): Promise<RagDocument[]> {
  const cardType = cardTypeFor(filePath);
  const documents: RagDocument[] = [];
  const lines = createInterface({ input: createReadStream(filePath, "utf8"), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    const payload = JSON.parse(line) as Record<string, unknown>;
    const id = String(payload.card_id ?? payload.dataset_id ?? payload.bundle_id ?? `${cardType}:${lineNumber}`);
    const strings: string[] = [];
    collectStrings(payload, strings, new Set());
    const sourceIds = new Set<string>();
    collectIds(payload, sourceIds);
    const content = indexedContent(cardType, payload, strings.join("\n"));
    documents.push({
      id,
      cardType,
      title: titleFor(cardType, payload),
      content,
      sourceIds: [...sourceIds],
      payload,
      sourcePath: filePath,
      sourceHash: createHash("sha256").update(line).digest("hex"),
    });
  }
  return documents;
}
