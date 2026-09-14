import type { StreamEvent, ToolTrace } from "./contracts.js";

export interface RunActivity {
  id: string;
  kind: "text" | "tool" | "progress";
  text?: string;
  toolName?: string;
  detail?: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "completed" | "failed";
  createdAt: string;
  finishedAt?: string;
}

// The same reducer drives live SSE and persisted history, preserving execution order.
export function reduceRunTimeline(items: RunActivity[], event: StreamEvent): RunActivity[] {
  const data = event.data as Record<string, unknown>;
  if (event.type === "run.progress" && ["正在推理下一步", "正在分析工具结果", "模型响应异常，正在自动重试", "正在整理长会话上下文"].includes(String(data.label))) {
    const last = items.at(-1);
    if (last?.kind === "progress" && last.text === data.label) return items;
    return [...items, { id: `progress-${event.id ?? items.length}`, kind: "progress",
      text: String(data.label), status: "completed", createdAt: event.createdAt }];
  }
  if (event.type === "message.delta" || event.type === "message.completed") {
    const last = items.at(-1);
    const id = typeof data.messageId === "string" ? data.messageId
      : last?.kind === "text" ? last.id : `text-${event.id ?? items.length}`;
    const existing = items.find((item) => item.id === id);
    const text = event.type === "message.completed" ? String(data.text ?? "")
      : (existing?.text ?? "") + String(data.delta ?? "");
    if (!text) return items;
    const item: RunActivity = {
      id, kind: "text", text, status: "completed", createdAt: existing?.createdAt ?? event.createdAt,
    };
    return existing ? items.map((entry) => entry.id === id ? item : entry) : [...items, item];
  }
  if (event.type === "tool.started") {
    if (items.some((item) => item.id === data.id)) return items;
    return [...items, {
      id: String(data.id), kind: "tool", toolName: String(data.name),
      detail: typeof data.detail === "string" ? data.detail : undefined,
      args: data.args, status: "running", createdAt: event.createdAt,
    }];
  }
  if (event.type === "tool.progress" || event.type === "tool.completed") {
    return items.map((item) => item.id === data.id ? {
      ...item, result: data.result ?? item.result,
      status: event.type === "tool.completed" ? data.failed ? "failed" : "completed" : "running",
      finishedAt: event.type === "tool.completed" ? event.createdAt : undefined,
    } : item);
  }
  if (event.type === "run.settled" || event.type === "run.error") {
    return items.map((item) => item.status === "running"
      ? { ...item, status: "failed", finishedAt: event.createdAt } : item);
  }
  return items;
}

export function restoreRunTimeline(events: StreamEvent[], traces: ToolTrace[]): RunActivity[] {
  const items = events.reduce(reduceRunTimeline, []);
  for (const trace of traces) {
    const index = items.findIndex((item) => item.id === trace.id);
    const activity: RunActivity = {
      id: trace.id, kind: "tool", toolName: trace.name, detail: trace.detail,
      args: trace.args, result: trace.result, status: trace.status,
      createdAt: trace.startedAt, finishedAt: trace.finishedAt,
    };
    if (index >= 0) items[index] = { ...activity,
      status: trace.status === "running" ? items[index]!.status : trace.status,
    };
    else items.push(activity);
  }
  return items;
}
