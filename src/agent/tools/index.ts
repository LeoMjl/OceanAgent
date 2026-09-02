import type { AppConfig } from "../../config.js";
import type { RagService } from "../../rag/rag-service.js";
import type { OfficialWebSearch } from "../../web-search.js";
import type { OceanToolContext } from "../tool-context.js";
import { createOceanKnowledgeTools } from "./search-ocean-knowledge.js";
import { createSearchOfficialWebTool } from "./search-official-web.js";
import { createProposeResearchPlanTool, createRequestClarificationTool } from "./workflow-tools.js";
import { createRunRemoteCommandTool, type ProjectRemoteTarget } from "./run-remote-command.js";
import { createReportResearchReasoningTool } from "./report-research-reasoning.js";

export const OCEAN_TOOL_NAMES = [
  "search_research_cases",
  "expand_research_case",
  "search_ocean_datasets",
  "get_dataset_facts",
  "search_official_web",
  "report_research_reasoning",
  "request_clarification",
  "propose_research_plan",
  "run_remote_command",
];

export const PI_CORE_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

export const ACTIVE_TOOL_NAMES = [
  ...PI_CORE_TOOL_NAMES,
  ...OCEAN_TOOL_NAMES,
];

export function createOceanTools(
  rag: RagService,
  webSearch: OfficialWebSearch,
  context: OceanToolContext,
  config: AppConfig,
  remoteTarget?: ProjectRemoteTarget,
) {
  return [
    ...createOceanKnowledgeTools(rag, context),
    createSearchOfficialWebTool(webSearch, context),
    createReportResearchReasoningTool(),
    createRequestClarificationTool(context),
    createProposeResearchPlanTool(context),
    createRunRemoteCommandTool(config, remoteTarget),
  ];
}
