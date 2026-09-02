import type { ResearchPlan } from "../contracts.js";

const APPROVAL_MESSAGES = new Set([
  "开始",
  "开始执行",
  "开始实验",
  "执行",
  "执行规划",
  "执行计划",
  "继续",
  "继续执行",
  "确认",
  "确认执行",
  "同意",
  "同意执行",
  "按规划执行",
  "按计划执行",
  "可以开始",
  "好的开始",
  "start",
  "proceed",
  "approve",
]);

export function isPlanApprovalMessage(content: string): boolean {
  const normalized = content
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:]+/g, "")
    .replace(/^(好的|好|可以|我确认)/, "")
    .replace(/[吧呀啊]$/, "");
  if (/^(不|不要|暂不|停止|取消)/.test(normalized)) return false;
  return APPROVAL_MESSAGES.has(normalized) || /^(开始|执行)(这个)?(科研)?(规划|计划|实验)$/.test(normalized);
}

export function findApprovedPlan(
  plans: ResearchPlan[],
  branchNodeIds: ReadonlySet<string>,
  content: string,
): ResearchPlan | null {
  if (!isPlanApprovalMessage(content)) return null;
  return plans.find((plan) => (
    plan.status === "awaiting_approval"
    && !!plan.nodeId
    && branchNodeIds.has(plan.nodeId)
  )) ?? null;
}
