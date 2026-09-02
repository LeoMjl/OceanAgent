import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { OfficialWebSearch } from "../../web-search.js";
import type { OceanToolContext } from "../tool-context.js";

export function createSearchOfficialWebTool(search: OfficialWebSearch, context: OceanToolContext) {
  let searchCount = 0;
  return defineTool({
    name: "search_official_web",
    label: "搜索官方网页",
    description: "联网搜索当前官方资料。适用于最新数据版本、当前访问入口、更新公告和Ocean-RAG未覆盖的时效信息；优先传入官方机构域名。",
    parameters: Type.Object({
      query: Type.String({ description: "要搜索的具体问题" }),
      domains: Type.Array(Type.String(), { minItems: 1, maxItems: 6, description: "限定检索的官方机构域名，例如 noaa.gov" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 6 })),
    }),
    async execute(_toolCallId, params, signal) {
      searchCount += 1;
      if (searchCount > 2) {
        return {
          content: [{ type: "text", text: "本轮已完成2次联网检索。请基于现有结果回答，或明确仍未核实的内容。" }],
          details: { query: params.query, limited: true, results: [] },
        };
      }
      const results = await search.search(params.query, params.domains, params.limit ?? 6, signal);
      for (const result of results) {
        context.addCitation({
          sourceType: "web",
          sourceId: result.url,
          title: result.title,
          url: result.url,
          evidenceText: result.snippet,
          metadata: { query: params.query },
        });
      }
      return {
        content: [{ type: "text", text: results.length ? JSON.stringify(results) : "联网搜索没有返回结果。" }],
        details: { query: params.query, limited: false, results },
      };
    },
  });
}
