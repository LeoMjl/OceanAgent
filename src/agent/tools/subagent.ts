import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runSubagentSession, type SubagentResult, type SubagentSessionOptions } from "../subagent-session.js";

export const SUBAGENT_LIMIT = 3;
export const SUBAGENT_RUN_BUDGET = 6;
export function childToolNames(remote: boolean, executionApproved: boolean): string[] {
  const research = ["search_research_cases", "expand_research_case", "search_ocean_datasets",
    "get_dataset_facts", "search_official_web", "report_research_reasoning"];
  if (!remote) research.push("read");
  if (executionApproved) research.push(...(remote ? ["run_remote_command"] : ["bash", "edit", "write"]));
  return research;
}

export function createSubagentTool(
  options: SubagentSessionOptions,
  executeChild = runSubagentSession,
) {
  let active = 0;
  let total = 0;
  return defineTool({
    name: "subagent",
    label: "科研子智能体协作",
    description: "按实际需要派出独立上下文的科研子智能体。可同时分配1至3个互不依赖的任务，如数据源核验、文献证据检索、方法审查；执行获批后也可分工计算和文件产出。每轮最多6个子任务。一次调用等待该批子任务结束并返回各自结果，主智能体负责整合、处理分歧与最终答复。简单任务不要委派。必须传递必要背景和明确产出；并行执行不得修改同一文件。子智能体不能继续委派、请求用户确认或制定待审批规划。",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        name: Type.String({ minLength: 1, maxLength: 80, description: "职责名称，例如 数据源核验" }),
        task: Type.String({ minLength: 10, maxLength: 6000, description: "具体目标、边界、负责的文件/目录及预期产出" }),
        context: Type.Optional(Type.String({ maxLength: 12000, description: "必要的任务背景、已有结论、证据和约束" })),
      }), { minItems: 1, maxItems: SUBAGENT_LIMIT }),
    }),
    async execute(_id, params, signal, onUpdate) {
      if (signal?.aborted) throw new Error("主任务已停止");
      if (!params.tasks.length || params.tasks.length > SUBAGENT_LIMIT) throw new Error("每批只能分配1至3个子任务");
      if (active + params.tasks.length > SUBAGENT_LIMIT) throw new Error("当前子智能体并发已达上限，请等待现有任务结束");
      if (total + params.tasks.length > SUBAGENT_RUN_BUDGET) throw new Error("本轮子任务预算已用完，请根据已有结果继续完成任务");
      active += params.tasks.length;
      total += params.tasks.length;
      const results: SubagentResult[] = params.tasks.map((task) => ({
        ...task, id: randomUUID(), status: "running", output: "", activities: [],
      }));
      const snapshot = () => ({
        content: [{ type: "text" as const, text: results.map((result) =>
          `【${result.name} · ${result.status}】\n${result.output || "子智能体正在处理"}`).join("\n\n") }],
        details: { subagents: structuredClone(results) },
      });
      let lastUpdate = 0;
      const update = () => {
        if (Date.now() - lastUpdate < 300 && results.some((result) => result.status === "running")) return;
        lastUpdate = Date.now();
        onUpdate?.(snapshot());
      };
      try {
        onUpdate?.(snapshot());
        await Promise.all(results.map(async (result) => {
          try { await executeChild(options, result, signal ?? new AbortController().signal, update); }
          catch (error) { result.status = "failed"; result.output = error instanceof Error ? error.message : String(error); }
        }));
        return snapshot();
      } finally { active -= params.tasks.length; }
    },
  });
}
