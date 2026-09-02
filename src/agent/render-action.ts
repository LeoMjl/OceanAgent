import type { ResearchPlan } from "../contracts.js";
import type { TerminalAction } from "./tool-context.js";

export function renderPlan(plan: ResearchPlan): string {
  const lines = [
    `## 科研规划 v${plan.version}`,
    "",
    `**研究目标：** ${plan.objective}`,
  ];
  if (plan.datasets.length) lines.push("", `**建议数据：** ${plan.datasets.join("、")}`);
  if (plan.assumptions.length) lines.push("", "**当前假设：**", ...plan.assumptions.map((item) => `- ${item}`));
  lines.push("", "### 执行步骤");
  plan.steps.forEach((step, index) => {
    const dependency = step.dependsOn.length ? `（依赖：${step.dependsOn.join("、")}）` : "";
    lines.push("", `${index + 1}. **${step.title}** ${dependency}`, `   ${step.description}`);
    if (step.expectedOutputs.length) lines.push(`   产物：${step.expectedOutputs.join("、")}`);
  });
  if (plan.deliverables.length) lines.push("", "### 预期产物", ...plan.deliverables.map((item) => `- ${item}`));
  if (plan.risks.length) lines.push("", "### 风险与限制", ...plan.risks.map((item) => `- ${item}`));
  if (plan.estimatedCost) lines.push("", `**预计成本/时间：** ${plan.estimatedCost}`);
  lines.push("", "请确认是否按此规划执行，或指出需要修改的步骤。当前尚未开始执行。 ");
  return lines.join("\n");
}

export function renderTerminalAction(action: TerminalAction): string {
  if (action.type === "plan") return renderPlan(action.plan);
  return [
    action.summary,
    "",
    ...action.questions.map((question, index) => `${index + 1}. **${question.label}**：${question.question}`),
  ].join("\n");
}
