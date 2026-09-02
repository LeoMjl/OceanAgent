import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PlanStep } from "../../contracts.js";
import type { OceanToolContext } from "../tool-context.js";

const StringList = Type.Optional(Type.Array(Type.String(), { default: [] }));

interface PlanStepInput {
  id: string;
  title: string;
  description: string;
  tool?: string;
  inputs?: Record<string, unknown>;
  dependsOn?: string[];
  expectedOutputs?: string[];
  risks?: string[];
}

const PlanStepSchema = Type.Object({
  id: Type.String({ description: "步骤稳定标识，例如 S1" }),
  title: Type.String(),
  description: Type.String(),
  tool: Type.Optional(Type.String()),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  dependsOn: StringList,
  expectedOutputs: StringList,
  risks: StringList,
});

function firstJsonArray(value: string): unknown {
  const start = value.indexOf("[");
  if (start < 0) throw new Error("科研规划步骤必须是JSON数组");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(value.slice(start, index + 1));
    }
  }
  throw new Error("科研规划步骤JSON数组不完整");
}

export function normalizePlanSteps(value: unknown): PlanStepInput[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value.trim());
    } catch {
      parsed = firstJsonArray(value);
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("科研规划至少需要一个步骤");
  for (const step of parsed) {
    if (!step || typeof step !== "object") throw new Error("科研规划步骤必须是对象");
    const item = step as Record<string, unknown>;
    if (![item.id, item.title, item.description].every((field) => typeof field === "string" && field.trim())) {
      throw new Error("科研规划步骤缺少id、title或description");
    }
  }
  return parsed as PlanStepInput[];
}

export function createRequestClarificationTool(context: OceanToolContext) {
  return defineTool({
    name: "request_clarification",
    label: "请求补充科研参数",
    description: "当缺少会实质改变结论或科研规划的关键信息时，生成最少量的结构化问题并结束当前轮。不要用于可通过合理假设解决的细节。",
    parameters: Type.Object({
      summary: Type.String({ description: "说明为什么需要补充信息" }),
      questions: Type.Array(Type.Object({
        id: Type.String({ description: "稳定的英文或拼音字段名，例如 spatial_range" }),
        label: Type.String({ description: "表单短标签" }),
        question: Type.String({ description: "面向用户的清晰问题" }),
        required: Type.Boolean({ default: true }),
        reason: Type.Optional(Type.String({ description: "该信息如何影响研究结果" })),
        options: Type.Array(Type.Object({
          value: Type.String({ description: "提交给智能体的稳定值" }),
          label: Type.String({ description: "用户可直接选择的短文本" }),
          description: Type.Optional(Type.String({ description: "该选项的简短说明" })),
        }), { minItems: 2, maxItems: 6, description: "优先覆盖最常见且互斥的答案" }),
        allowCustom: Type.Boolean({ default: true, description: "没有合适选项时是否允许用户填写其他答案" }),
      }), { minItems: 1, maxItems: 6 }),
    }),
    async execute(_toolCallId, params) {
      const action = { type: "clarification" as const, summary: params.summary, questions: params.questions };
      context.setTerminalAction(action);
      return {
        content: [{ type: "text", text: `需要用户补充：${params.questions.map((item) => item.question).join("；")}` }],
        details: action,
        terminate: true,
      };
    },
  });
}

export function createProposeResearchPlanTool(context: OceanToolContext) {
  return defineTool({
    name: "propose_research_plan",
    label: "提出科研规划",
    description: "为复杂海洋科研需求提出结构化、可审核的计划。调用后进入等待用户确认状态，不能继续执行计划。",
    parameters: Type.Object({
      objective: Type.String({ description: "可验证的研究目标" }),
      assumptions: StringList,
      requiredInputs: StringList,
      datasets: StringList,
      evidenceNeeds: StringList,
      steps: Type.Union([
        Type.Array(PlanStepSchema, { minItems: 1, maxItems: 20 }),
        Type.String({ description: "兼容模型偶发返回的JSON数组字符串；应优先传入真实数组" }),
      ]),
      deliverables: StringList,
      risks: StringList,
      estimatedCost: Type.Optional(Type.String({ description: "预计时间、Token、存储或计算量；未知时说明未知" })),
    }),
    async execute(_toolCallId, params) {
      const rawSteps = normalizePlanSteps(params.steps);
      const steps: PlanStep[] = rawSteps.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        tool: step.tool,
        inputs: step.inputs,
        dependsOn: step.dependsOn ?? [],
        expectedOutputs: step.expectedOutputs ?? [],
        risks: step.risks ?? [],
      }));
      const ids = new Set(steps.map((step) => step.id));
      if (ids.size !== steps.length) throw new Error("科研规划的步骤id不能重复");
      for (const step of steps) {
        const unknown = step.dependsOn.filter((dependency) => !ids.has(dependency));
        if (unknown.length) throw new Error(`步骤${step.id}引用了不存在的依赖：${unknown.join(", ")}`);
      }
      const plan = context.createPlan({
        objective: params.objective,
        assumptions: params.assumptions ?? [],
        requiredInputs: params.requiredInputs ?? [],
        datasets: params.datasets ?? [],
        evidenceNeeds: params.evidenceNeeds ?? [],
        steps,
        deliverables: params.deliverables ?? [],
        risks: params.risks ?? [],
        estimatedCost: params.estimatedCost,
      });
      context.setTerminalAction({ type: "plan", plan });
      return {
        content: [{ type: "text", text: `科研规划v${plan.version}已生成，正在等待用户确认。` }],
        details: { plan },
        terminate: true,
      };
    },
  });
}
