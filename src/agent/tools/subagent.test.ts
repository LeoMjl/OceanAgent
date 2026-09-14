import { describe, expect, it } from "vitest";
import { childToolNames, createSubagentTool } from "./subagent.js";
import type { SubagentSessionOptions } from "../subagent-session.js";

const task = { name: "核验", task: "核验数据源并返回有来源的结果" };
describe("research subagent dispatch", () => {
  it("limits permissions and prevents recursive delegation or workflow approval", () => {
    expect(childToolNames(false, false)).toContain("read");
    expect(childToolNames(false, false)).not.toContain("bash");
    expect(childToolNames(true, false)).not.toContain("run_remote_command");
    expect(childToolNames(false, true)).toEqual(expect.arrayContaining(["bash", "edit", "write"]));
    expect(childToolNames(true, true)).toContain("run_remote_command");
    for (const name of ["subagent", "propose_research_plan", "request_clarification", "bash"]) {
      expect(childToolNames(true, true)).not.toContain(name);
    }
  });

  it("runs independent tasks concurrently, isolates failures and persists result snapshots", async () => {
    let running = 0;
    let peak = 0;
    const updates: unknown[] = [];
    const tool = createSubagentTool({} as SubagentSessionOptions, async (_options, result, _signal, update) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      if (result.name === "失败") throw new Error("数据源不可用");
      result.status = "completed";
      result.output = "验证通过";
      update();
    });
    const result = await tool.execute("call", { tasks: [task, { ...task, name: "失败" }] }, undefined,
      (update) => updates.push(update), {} as never);
    expect(peak).toBe(2);
    expect(result.details.subagents.map((child) => child.status)).toEqual(["completed", "failed"]);
    expect(result.content[0]?.text).toContain("数据源不可用");
    expect((updates[0] as typeof result).details.subagents[0]?.status).toBe("running");
    expect(result.details.subagents[0]?.id).not.toBe(result.details.subagents[1]?.id);
  });

  it("enforces a per-run budget and refuses dispatch after cancellation", async () => {
    const tool = createSubagentTool({} as SubagentSessionOptions, async (_options, result) => { result.status = "completed"; });
    const params = { tasks: [task, task, task] };
    await tool.execute("a", params, undefined, undefined, {} as never);
    await tool.execute("b", params, undefined, undefined, {} as never);
    await expect(tool.execute("c", { tasks: [task] }, undefined, undefined, {} as never)).rejects.toThrow("预算");
    const controller = new AbortController(); controller.abort();
    await expect(tool.execute("d", { tasks: [task] }, controller.signal, undefined, {} as never)).rejects.toThrow("停止");
  });

  it("shares the concurrency limit across overlapping tool calls", async () => {
    const releases: Array<() => void> = [];
    const tool = createSubagentTool({} as SubagentSessionOptions, async (_options, result) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      result.status = "completed";
    });
    const first = tool.execute("a", { tasks: [task, task, task] }, undefined, undefined, {} as never);
    await expect(tool.execute("b", { tasks: [task] }, undefined, undefined, {} as never)).rejects.toThrow("并发");
    releases.forEach((release) => release());
    await first;
  });
});
