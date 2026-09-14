import type { RunActivity } from "../../../src/run-timeline";
import type { SubagentResult } from "../../../src/agent/subagent-session";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object"
  ? value as Record<string, unknown> : {};

export function subagentsForActivity(item: RunActivity): SubagentResult[] {
  if (item.toolName !== "subagent") return [];
  const children = record(record(item.result).details).subagents;
  if (Array.isArray(children)) return children.map((child) => ({
    ...child,
    // A interrupted parent can leave its last child snapshot marked running.
    status: child.status === "running" && item.status !== "running" ? "failed" : child.status,
  }));
  const tasks = record(item.args).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task, index) => ({
    id: `${item.id}:${index}`, name: String(record(task).name ?? "子智能体"),
    task: String(record(task).task ?? ""), output: "", activities: [],
    status: item.status === "running" ? "running" : "failed",
  }));
}

export function runningSubagents(activities: RunActivity[], busy: boolean): SubagentResult[] {
  if (!busy) return [];
  return activities.flatMap(subagentsForActivity).filter((child) => child.status === "running");
}
