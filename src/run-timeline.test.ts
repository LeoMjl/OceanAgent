import { describe, expect, it } from "vitest";
import type { StreamEvent } from "./contracts.js";
import { reduceRunTimeline, restoreRunTimeline } from "./run-timeline.js";

const event = (type: StreamEvent["type"], data: unknown): StreamEvent => ({
  type, data, runId: "run", createdAt: "2026-09-13T08:00:00Z",
});

describe("execution timeline", () => {
  it("preserves recurring thinking and result-analysis states without exposing private thinking", () => {
    const items = [
      event("run.progress", { label: "正在推理下一步" }),
      event("tool.started", { id: "a", name: "bash" }),
      event("tool.completed", { id: "a", failed: false }),
      event("run.progress", { label: "正在分析工具结果" }),
      event("run.progress", { label: "正在分析工具结果" }),
      event("run.progress", { label: "正在推理下一步" }),
    ].reduce(reduceRunTimeline, []);
    expect(items.filter((item) => item.kind === "progress").map((item) => item.text))
      .toEqual(["正在推理下一步", "正在分析工具结果", "正在推理下一步"]);
  });
  it("interleaves commentary and parallel commands, replacing partial output with the final result", () => {
    const events = [
      event("message.delta", { messageId: "m1", delta: "先检查" }),
      event("message.delta", { messageId: "m1", delta: "文件。" }),
      event("message.completed", { messageId: "m1", text: "先检查文件。" }),
      event("tool.started", { id: "a", name: "bash", args: { command: "Get-Location" } }),
      event("tool.started", { id: "b", name: "bash", args: { command: "Get-ChildItem" } }),
      event("tool.progress", { id: "a", result: { content: [{ type: "text", text: "partial" }] } }),
      event("tool.completed", { id: "b", failed: true, result: "failure" }),
      event("tool.completed", { id: "a", failed: false, result: "complete" }),
      event("message.completed", { messageId: "m2", text: "检查完成。" }),
    ];
    const live = events.reduce(reduceRunTimeline, []);
    expect(live.map((item) => item.id)).toEqual(["m1", "a", "b", "m2"]);
    expect(live[0]?.text).toBe("先检查文件。");
    expect(live[1]).toMatchObject({ result: "complete", args: { command: "Get-Location" } });
    expect(live[2]?.status).toBe("failed");
    expect(restoreRunTimeline(events, [])).toEqual(live);
  });

  it("retains failed attempts and marks unfinished calls when a run stops", () => {
    const items = [
      event("tool.started", { id: "a", name: "bash" }),
      event("tool.completed", { id: "a", failed: true }),
      event("tool.started", { id: "b", name: "bash" }),
      event("run.error", {}),
    ].reduce(reduceRunTimeline, []);
    expect(items.map((item) => item.status)).toEqual(["failed", "failed"]);
  });

  it("restores legacy deltas on either side of tools and fills saved arguments/results", () => {
    const command = "Write-Output '" + "long command ".repeat(50) + "'";
    const items = restoreRunTimeline([
      event("message.delta", { delta: "Before" }),
      event("tool.started", { id: "a", name: "bash" }),
      event("message.delta", { delta: "After" }),
    ], [{
      id: "a", runId: "run", name: "bash", status: "completed",
      startedAt: "2026-09-13T08:00:00Z", args: { command }, result: "done",
    }]);
    expect(items.map((item) => item.kind)).toEqual(["text", "tool", "text"]);
    expect(items[1]).toMatchObject({ args: { command }, result: "done", status: "completed" });
  });
});
