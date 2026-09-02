import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RagSearchResult } from "../../contracts.js";
import { RagService } from "../../rag/rag-service.js";
import { researchFieldLabel } from "../../rag/research-fields.js";
import type { RagDocument } from "../../rag/types.js";
import type { OceanToolContext } from "../tool-context.js";

const ResearchFieldSchema = Type.Union([
  Type.Literal("D0601"), Type.Literal("D0602"), Type.Literal("D0603"),
  Type.Literal("D0604"), Type.Literal("D0605"), Type.Literal("D0606"),
  Type.Literal("D0607"), Type.Literal("D0608"), Type.Literal("D0609"),
  Type.Literal("D0610"), Type.Literal("D0611"), Type.Literal("D0612"),
  Type.Literal("D0613"), Type.Literal("D0614"), Type.Literal("D0615"),
]);

function firstEvidence(value: unknown): { quote?: string; locator?: string; url?: string } {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstEvidence(item);
      if (found.quote || found.url) return found;
    }
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const quote = typeof object.quote === "string" ? object.quote : undefined;
    const locator = typeof object.page_or_section === "string" ? object.page_or_section : undefined;
    const url = typeof object.url === "string"
      ? object.url
      : typeof object.source_url === "string" ? object.source_url : undefined;
    if (quote || url) return { quote, locator, url };
    for (const item of Object.values(object)) {
      const found = firstEvidence(item);
      if (found.quote || found.url) return found;
    }
  }
  return {};
}

function researchCandidate(result: RagSearchResult): Record<string, unknown> {
  const field = result.payload.research_field as Record<string, unknown> | undefined;
  const secondary = Array.isArray(field?.secondary) ? field.secondary.map(String) : [];
  return {
    cardId: result.id,
    researchField: {
      primary: researchFieldLabel(String(field?.primary ?? "unresolved")),
      secondary: secondary.map(researchFieldLabel),
    },
    problem: result.payload.problem,
    solutionSummary: result.payload.solution_summary,
    bundleId: result.payload.bundle_id,
    evidence: result.payload.evidence,
    score: Number(result.score.toFixed(6)),
  };
}

function datasetCandidate(result: RagSearchResult): Record<string, unknown> {
  return {
    datasetId: result.id,
    productId: result.payload.product_id,
    name: result.payload.name,
    aliases: result.payload.aliases,
    provider: result.payload.provider,
    version: result.payload.version,
    description: result.payload.description,
    coverage: result.payload.coverage,
    resolution: result.payload.resolution,
    score: Number(result.score.toFixed(6)),
  };
}

function addDocumentCitation(context: OceanToolContext, document: RagDocument): void {
  const evidence = firstEvidence(document.payload);
  context.addCitation({
    sourceType: "ocean_rag",
    sourceId: document.id,
    title: document.title,
    locator: evidence.locator,
    url: evidence.url,
    evidenceText: evidence.quote ?? document.content.slice(0, 900),
    metadata: { cardType: document.cardType, sourceIds: document.sourceIds },
  });
}

export function createOceanKnowledgeTools(rag: RagService, context: OceanToolContext) {
  let caseSearchCount = 0;
  let datasetSearchCount = 0;

  const searchCases = defineTool({
    name: "search_research_cases",
    label: "按研究领域检索相似研究",
    description: "只检索ProblemSolutionCard。适用于寻找相似研究问题与总体方案；先按研究对象判断NSFC-D06领域，再在该领域内检索。返回候选后必须判断相关性，相关时再调用expand_research_case。",
    parameters: Type.Object({
      query: Type.String({ description: "用户的研究目标和约束，不要塞入尚未确认的数据集或方法" }),
      researchFields: Type.Optional(Type.Array(ResearchFieldSchema, {
        maxItems: 3,
        description: "根据核心研究对象判断的主领域及可能辅助领域代码；领域不明确时留空",
      })),
      fieldConfidence: Type.Optional(Type.Union([
        Type.Literal("high"), Type.Literal("medium"), Type.Literal("low"),
      ], { default: "low" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 6, default: 5 })),
    }),
    async execute(_toolCallId, params, signal) {
      const fields = params.researchFields ?? [];
      const confidence = fields.length ? (params.fieldConfidence ?? "medium") : "low";
      caseSearchCount += 1;
      if (caseSearchCount > 2) {
        return {
          content: [{ type: "text", text: "本轮相似研究检索已达2次。请判断已有候选、展开相关案例，或明确知识库不足。" }],
          details: { limited: true, fields, confidence, results: [] as RagSearchResult[] },
        };
      }
      const results = await rag.searchResearchCases(params.query, fields, confidence, params.limit ?? 5, signal);
      return {
        content: [{
          type: "text",
          text: results.length
            ? JSON.stringify({
              instruction: "这些只是候选研究先例，不是当前用户问题的直接答案。选择真正相关的cardId后调用expand_research_case。",
              candidates: results.map(researchCandidate),
            })
            : "当前研究领域和问题下没有找到相关ProblemSolutionCard。可放宽领域后再检索一次，或明确知识库不足。",
        }],
        details: { limited: false, fields, confidence, results },
      };
    },
  });

  const expandCase = defineTool({
    name: "expand_research_case",
    label: "展开相关研究的实验结构",
    description: "仅在模型确认某个ProblemSolutionCard与用户问题相关后调用。按card_id精确展开其UsageBundleCard，返回论文报告的实验DAG、数据用法、数据关系、验证方式和关联dataset_id。",
    parameters: Type.Object({
      cardId: Type.String({ description: "search_research_cases返回且已判断相关的ProblemSolutionCard cardId" }),
    }),
    async execute(_toolCallId, params) {
      const expanded = rag.expandResearchCase(params.cardId);
      addDocumentCitation(context, expanded.problem);
      addDocumentCitation(context, expanded.bundle);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            instruction: "这是已发表研究的参考结构。根据当前用户目标和约束重组方案，不要照抄，也不要声称尚未执行的步骤已完成。需要官方产品事实时调用get_dataset_facts。",
            problemSolutionReference: expanded.problem.payload,
            usageBundleReference: expanded.bundle.payload,
            datasetIds: expanded.datasetIds,
          }),
        }],
        details: expanded,
      };
    },
  });

  const searchDatasets = defineTool({
    name: "search_ocean_datasets",
    label: "检索可复用官方数据产品",
    description: "只检索DatasetCard。仅当用户明确询问数据产品，或已有清晰的变量、海域、时间、分辨率等数据需求时直接调用；不要用它搜索论文方法或实验方案。",
    parameters: Type.Object({
      query: Type.String({ description: "明确的数据需求，包括变量、海域、时间、深度、分辨率、提供方或产品名" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 6, default: 5 })),
    }),
    async execute(_toolCallId, params, signal) {
      datasetSearchCount += 1;
      if (datasetSearchCount > 2) {
        return {
          content: [{ type: "text", text: "本轮数据产品检索已达2次。请从现有候选中选择，或明确当前目录没有合适产品。" }],
          details: { limited: true, results: [] as RagSearchResult[] },
        };
      }
      const results = await rag.searchDatasets(params.query, params.limit ?? 5, signal);
      return {
        content: [{
          type: "text",
          text: results.length
            ? JSON.stringify({
              instruction: "这些是官方产品候选。选择满足用户约束的datasetId后调用get_dataset_facts核对字段、版本、覆盖和访问方式。",
              candidates: results.map(datasetCandidate),
            })
            : "DatasetCard中没有找到满足当前明确数据需求的产品。",
        }],
        details: { limited: false, results },
      };
    },
  });

  const getDatasetFacts = defineTool({
    name: "get_dataset_facts",
    label: "读取官方数据产品事实",
    description: "按dataset_id精确读取DatasetCard。用于核对可跨论文复用的官方产品名称、版本、覆盖、分辨率、字段、质量规则和访问入口；不包含某篇论文的实验切片。",
    parameters: Type.Object({
      datasetIds: Type.Array(Type.String(), { minItems: 1, maxItems: 6, description: "需要核对的DatasetCard dataset_id" }),
    }),
    async execute(_toolCallId, params) {
      const documents = rag.getDatasetCards(params.datasetIds);
      for (const document of documents) addDocumentCitation(context, document);
      const found = new Set(documents.map((document) => document.id));
      const missing = params.datasetIds.filter((id) => !found.has(id));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            instruction: "以下仅是官方产品事实。用户所需时空切片、组合方式和实验选择必须根据当前问题设计，不得写回产品完整覆盖。",
            datasets: documents.map((document) => document.payload),
            missingDatasetIds: missing,
          }),
        }],
        details: { documents, missing },
      };
    },
  });

  return [searchCases, expandCase, searchDatasets, getDatasetFacts];
}
