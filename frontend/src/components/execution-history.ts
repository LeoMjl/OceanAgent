import type { ConversationDetail } from "../api";
import type { RunActivity } from "../../../src/run-timeline";
import { activeBranch } from "../tree";

export function savedExecutionActivities(detail: ConversationDetail | null): RunActivity[] {
  if (!detail) return [];
  const branch = activeBranch(detail.nodes, detail.conversation.activeNodeId);
  for (const node of [...branch].reverse()) {
    if (node.role !== "assistant") continue;
    const saved = detail.activities?.[node.id];
    if (saved?.length) return saved;
    const traces = detail.traces[node.id] ?? [];
    if (traces.length) return traces.map((trace) => ({
      id: trace.id, kind: "tool", toolName: trace.name, detail: trace.detail,
      args: trace.args, result: trace.result, status: trace.status,
      createdAt: trace.startedAt, finishedAt: trace.finishedAt,
    }));
  }
  return [];
}
