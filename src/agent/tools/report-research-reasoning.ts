import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ReasoningStage = Type.Union([
  Type.Literal("problem_understanding"),
  Type.Literal("knowledge_routing"),
  Type.Literal("evidence_assessment"),
  Type.Literal("answer_design"),
  Type.Literal("execution_decision"),
]);

export function createReportResearchReasoningTool() {
  return defineTool({
    name: "report_research_reasoning",
    label: "记录科研推理摘要",
    description: [
      "向用户报告简洁、可审计的科研推理摘要。",
      "只写问题理解、路线选择依据、证据充分性、关键假设/不确定性和下一步决策；",
      "不得输出隐藏的逐字思维链、内部令牌、草稿或冗长自言自语。",
    ].join(""),
    parameters: Type.Object({
      stage: ReasoningStage,
      summary: Type.String({ minLength: 10, maxLength: 500, description: "1至3句用户可读的判断依据" }),
      decision: Type.Optional(Type.String({ maxLength: 240, description: "基于该判断采取的下一步" })),
      uncertainty: Type.Optional(Type.String({ maxLength: 240, description: "仍需说明的证据边界或不确定性" })),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "推理摘要已记录。请按该决策继续任务，不要重复展开内部思维过程。" }],
        details: params,
      };
    },
  });
}
