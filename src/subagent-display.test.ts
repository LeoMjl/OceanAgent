import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RunActivity } from "./run-timeline.js";
import { runningSubagents, subagentsForActivity } from "../frontend/src/components/subagent-activity";
import { ExecutionTimeline } from "../frontend/src/components/ExecutionTimeline";
import { EvidencePanel } from "../frontend/src/components/EvidencePanel";

const activity: RunActivity = {
  id: "batch", kind: "tool", toolName: "subagent", status: "running", createdAt: "",
  args: { tasks: [{ name: "数据质量核验", task: "检查海温数据缺测" }] },
};
const result = { details: { subagents: [
  { id: "a", name: "数据质量核验", task: "检查海温数据缺测", status: "completed", output: "核验通过", activities: [] },
  { id: "b", name: "距平统计", task: "计算面积加权距平", status: "running", output: "", activities: [] },
] } };
describe("subagent visibility", () => {
  it("shows task names immediately before the first progress update", () => {
    expect(runningSubagents([activity], true)[0]?.name).toBe("数据质量核验");
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { activities: [activity] }));
    expect(html).toContain("已创建 1 个子智能体");
    expect(html).toContain("数据质量核验");
    expect(html).toContain("正在工作");
    expect(html).toContain("subagent-visible");
  });
  it("keeps only live children in assets and retains finished children in history", () => {
    const item = { ...activity, result };
    expect(runningSubagents([item], true).map((child) => child.id)).toEqual(["b"]);
    expect(runningSubagents([item], false)).toEqual([]);
    const html = renderToStaticMarkup(createElement(EvidencePanel, {
      detail: null, livePlan: null, activities: [item], busy: true,
      status: "执行中", ragStatus: null, onPlanAction: () => {},
    }));
    expect(html).toContain("正在运行的子智能体");
    expect(html).toContain("距平统计");
    expect(html).not.toContain("数据质量核验");
    expect(subagentsForActivity(item)).toHaveLength(2);
  });
  it("does not report interrupted child snapshots as still running", () => {
    const stopped = { ...activity, result, status: "failed" as const };
    expect(runningSubagents([stopped], true)).toEqual([]);
    expect(subagentsForActivity(stopped)[1]?.status).toBe("failed");
  });
});
