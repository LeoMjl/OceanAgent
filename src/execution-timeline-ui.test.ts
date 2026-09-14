import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionTimeline } from "../frontend/src/components/ExecutionTimeline";
import { MessageCard } from "../frontend/src/components/MessageCard";
import type { RunActivity } from "./run-timeline.js";
import { ResearchTrace } from "../frontend/src/components/ResearchTrace";
import { durationLabel, splitExecution } from "../frontend/src/components/execution-summary";

const activities: RunActivity[] = [
  { id: "m1", kind: "text", text: "先检查文件。", status: "completed", createdAt: "2026-09-13T08:00:00Z" },
  { id: "t1", kind: "tool", toolName: "bash", args: { command: "Get-Location\nWrite-Output '<unsafe>'", timeout: 30 }, result: { content: [{ type: "text", text: "D:\\workspace\n<unsafe>" }], details: { exitCode: 0 } }, status: "completed", createdAt: "2026-09-13T08:00:00Z", finishedAt: "2026-09-13T08:00:02Z" },
  { id: "t2", kind: "tool", toolName: "run_remote_command", args: { command: "pwd" }, result: "permission denied", status: "failed", createdAt: "2026-09-13T08:00:00Z" },
  { id: "m2", kind: "text", text: "检查完成。", status: "completed", createdAt: "2026-09-13T08:00:03Z" },
];

describe("execution timeline UI", () => {
  it("renders persisted child-agent status and inspectable commands", () => {
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { activities: [{
      id: "batch", kind: "tool", toolName: "subagent", status: "completed", createdAt: "",
      result: { content: [{ type: "text", text: "子任务完成" }], details: { subagents: [{
        id: "child", name: "数据核验", task: "核验文件", status: "completed", output: "核验通过",
        activities: [activities[1]],
      }] } },
    }] }));
    expect(html).toContain("科研子智能体协作");
    expect(html).toContain("数据核验");
    expect(html).toContain("已完成");
    expect(html).toContain("Get-Location");
    expect(html).toContain("核验通过");
  });
  it("expands a live process and collapses a finished process with its duration", () => {
    const live = renderToStaticMarkup(createElement(ResearchTrace, { activities, live: true }));
    const done = renderToStaticMarkup(createElement(ResearchTrace, { activities, durationMs: 142000 }));
    expect(live).toMatch(/<details class="research-execution"[^>]* open/);
    expect(done).not.toMatch(/<details class="research-execution"[^>]* open/);
    expect(done).toContain("用时 2分 22秒");
    expect(durationLabel(undefined)).toBe("执行过程");
  });

  it("keeps the final answer outside the process and preserves terminal action content", () => {
    const split = splitExecution(activities, "先检查文件。\n\n检查完成。");
    expect(split.answer).toBe("检查完成。");
    expect(split.process.map((item) => item.id)).toEqual(["m1", "t1", "t2"]);
    expect(splitExecution(activities, "科研规划 v1").answer).toBe("科研规划 v1");
    const html = renderToStaticMarkup(createElement(MessageCard, {
      node: { id: "n", conversationId: "c", parentId: "u", role: "assistant", kind: "message", content: "先检查文件。\n\n检查完成。", metadata: { executionDurationMs: 142000 }, createdAt: "2026-09-13T08:00:00Z" }, activities,
    }));
    expect(html.lastIndexOf("</details>")).toBeLessThan(html.indexOf("检查完成"));
  });
  it("renders collapsed command groups with inspectable, escaped commands and output", () => {
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { activities }));
    expect(html).toContain("运行了命令");
    expect(html).toContain("含失败记录");
    expect(html).toContain("Get-Location\nWrite-Output &#x27;&lt;unsafe&gt;&#x27;");
    expect(html).toContain("D:\\workspace\n&lt;unsafe&gt;");
    expect(html).toContain("exitCode");
    expect(html).not.toContain("<unsafe>");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf("先检查文件")).toBeLessThan(html.indexOf("运行了命令"));
    expect(html.indexOf("permission denied")).toBeLessThan(html.indexOf("检查完成"));
  });

  it("shows streaming output while a tool is running", () => {
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, {
      activities: [{ ...activities[1]!, status: "running" }],
    }));
    expect(html).toContain("正在运行命令");
    expect(html).toContain("实时输出");
    expect(html).toContain("D:\\workspace");
  });

  it("does not duplicate the final answer after restoring commentary", () => {
    const html = renderToStaticMarkup(createElement(MessageCard, {
      node: { id: "n", conversationId: "c", parentId: "u", role: "assistant", kind: "message", content: "先检查文件。\n\n检查完成。", metadata: {}, createdAt: "2026-09-13T08:00:00Z" }, activities,
    }));
    expect(html.match(/先检查文件/g)).toHaveLength(1);
    expect(html.match(/检查完成/g)).toHaveLength(1);
  });
});
