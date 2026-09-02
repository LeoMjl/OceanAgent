import { describe, expect, it } from "vitest";
import type { ResearchPlan } from "../contracts.js";
import { findApprovedPlan, isPlanApprovalMessage } from "./plan-approval.js";

const plan = {
  id: "plan-1",
  conversationId: "conversation-1",
  nodeId: "plan-node",
  version: 1,
  status: "awaiting_approval",
  objective: "实验",
  assumptions: [],
  requiredInputs: [],
  datasets: [],
  evidenceNeeds: [],
  steps: [],
  deliverables: [],
  risks: [],
  createdAt: new Date().toISOString(),
} satisfies ResearchPlan;

describe("natural-language plan approval", () => {
  it.each(["开始", "好的，开始执行。", "确认执行", "按规划执行", "proceed"])(
    "recognizes %s as an explicit approval",
    (message) => expect(isPlanApprovalMessage(message)).toBe(true),
  );

  it.each(["不要开始", "暂不执行", "修改规划", "开始时间是什么？"])(
    "does not treat %s as approval",
    (message) => expect(isPlanApprovalMessage(message)).toBe(false),
  );

  it("only approves a pending plan on the selected conversation branch", () => {
    expect(findApprovedPlan([plan], new Set(["plan-node"]), "开始")?.id).toBe(plan.id);
    expect(findApprovedPlan([plan], new Set(["other-node"]), "开始")).toBeNull();
  });
});
