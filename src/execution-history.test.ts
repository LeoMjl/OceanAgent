import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { savedExecutionActivities } from "../frontend/src/components/execution-history";
import { EvidencePanel } from "../frontend/src/components/EvidencePanel";
import type { ConversationDetail } from "../frontend/src/api";
import type { RunActivity } from "./run-timeline.js";

const activity = (id: string): RunActivity => ({
  id, kind: "text", text: id, status: "completed", createdAt: "2026-09-13T08:00:00Z",
});
function fixture(): ConversationDetail {
  return {
    conversation: { id: "c", projectId: "p", title: "test", activeNodeId: "a", createdAt: "", updatedAt: "" },
    nodes: [
      { id: "u", conversationId: "c", parentId: null, role: "user", kind: "message", content: "test", metadata: {}, createdAt: "" },
      ...["a", "b"].map((id) => ({ id, conversationId: "c", parentId: "u", role: "assistant" as const, kind: "message" as const, content: "done", metadata: {}, createdAt: "" })),
    ],
    activities: { a: [activity("保存的执行记录")], b: [activity("另一分支记录")] },
    traces: {}, plans: [], citations: {},
  };
}

describe("execution rail restoration", () => {
  it("restores persisted records without any in-memory events", () => {
    const detail = JSON.parse(JSON.stringify(fixture())) as ConversationDetail;
    const html = renderToStaticMarkup(createElement(EvidencePanel, {
      detail, activities: [], livePlan: null, busy: false, status: "就绪", ragStatus: null, onPlanAction: () => {},
    }));
    expect(html).toContain("保存的执行记录");
    expect(html).toContain("执行阶段");
    expect(html).not.toContain("另一分支记录");
    expect(html).not.toContain("widget-empty");
  });

  it("follows the selected branch and clears history for a new conversation", () => {
    const detail = fixture();
    detail.conversation.activeNodeId = "b";
    expect(savedExecutionActivities(detail)[0]?.id).toBe("另一分支记录");
    detail.conversation.activeNodeId = "u";
    expect(savedExecutionActivities(detail)).toEqual([]);
    expect(savedExecutionActivities(null)).toEqual([]);
  });

  it("uses live events while running without mixing saved records", () => {
    const html = renderToStaticMarkup(createElement(EvidencePanel, {
      detail: fixture(), activities: [activity("实时执行记录")], livePlan: null,
      busy: true, status: "执行中", ragStatus: null, onPlanAction: () => {},
    }));
    expect(html).toContain("实时执行记录");
    expect(html).not.toContain("保存的执行记录");
  });

  it("recovers older tool-only history with failure status", () => {
    const detail = fixture();
    delete detail.activities;
    detail.traces.a = [{ id: "t", runId: "r", name: "bash", status: "failed", startedAt: "", args: { command: "pwd" } }];
    expect(savedExecutionActivities(detail)[0]).toMatchObject({ id: "t", status: "failed", args: { command: "pwd" } });
  });
});
