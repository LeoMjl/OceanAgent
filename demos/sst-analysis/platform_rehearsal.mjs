// Opt-in platform integration rehearsal. Explicit flag simulates the user's approval.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const base = process.env.OCEAN_DEMO_URL ?? "http://127.0.0.1:3210";
const log = { startedAt: new Date().toISOString(), events: [], projectId: null, conversationId: null, planId: null };
async function checkpoint() { await writeFile(resolve(root, "rehearsal-platform.json"), JSON.stringify(log, null, 2)); }
async function request(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
async function follow(path) {
  const response = await fetch(base + path);
  if (!response.ok || !response.body) throw new Error("SSE connection failed");
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const type = block.match(/^event: (.+)$/m)?.[1];
      const raw = block.match(/^data: (.+)$/m)?.[1];
      if (!type || !raw) continue;
      const data = JSON.parse(raw);
      if (type === "tool.started" || type === "tool.completed") {
        log.events.push({ type, name: data.name, failed: data.failed });
        console.log(JSON.stringify({ type, name: data.name, failed: data.failed }));
      }
      if (type === "run.error") throw new Error(data.message ?? data.reason ?? "run.error");
      if (type === "run.settled") { await checkpoint(); return; }
    }
  }
  throw new Error("SSE ended before run settled");
}

try {
  const models = await request("/api/model-settings");
  const model = models.enabledModels.find((item) => item.providerId === "dashscope-ocean") ?? models.enabledModels[0];
  if (!model) throw new Error("Configure an available model first");
  const projects = await request("/api/projects");
  const project = projects.find((item) => item.workspacePath.toLowerCase() === root.toLowerCase())
    ?? await request("/api/projects", { title: "南海海温分析演示", executionTarget: "local", workspacePath: root });
  log.projectId = project.id;
  const conversation = await request("/api/conversations", { projectId: project.id, title: "平台全流程彩排 · 南海SST" });
  log.conversationId = conversation.id;
  await checkpoint();
  const content = await readFile(resolve(root, "DEMO_PROMPT.md"), "utf8");
  const first = await request(`/api/conversations/${conversation.id}/messages`, {
    content, model: { providerId: model.providerId, modelId: model.modelId },
  });
  await follow(first.eventsUrl);
  let detail = await request(`/api/conversations/${conversation.id}`);
  const plan = detail.plans.find((item) => item.status === "awaiting_approval");
  if (!plan) throw new Error("No reviewable plan was proposed");
  log.planId = plan.id;
  log.waitedForApproval = true;
  await checkpoint();
  if (!process.argv.includes("--approve-rehearsal")) {
    console.log("Plan ready. Approve it in the platform to execute.");
  } else {
    const approved = await request(`/api/plans/${plan.id}/approve`, {});
    await follow(approved.eventsUrl);
    detail = await request(`/api/conversations/${conversation.id}`);
    log.finalPlanStatus = detail.plans.find((item) => item.id === plan.id)?.status;
    log.finishedAt = new Date().toISOString();
    const tools = Object.values(detail.activities ?? {}).flat();
    const delivery = tools.filter((item) => item.toolName === "complete_research_plan" && item.status === "completed").at(-1);
    log.artifacts = delivery?.result?.details?.artifacts ?? [];
    log.subagentBatches = tools.filter((item) => item.toolName === "subagent").length;
    await checkpoint();
    if (log.finalPlanStatus !== "completed" || !log.artifacts.length) throw new Error("Plan did not complete verified delivery");
    const report = log.artifacts.find((item) => item.name === "report.html");
    if (!report || !(await fetch(base + report.url)).ok) throw new Error("Report link is unavailable");
    console.log(JSON.stringify({ status: log.finalPlanStatus, subagentBatches: log.subagentBatches, report: base + report.url }));
  }
} catch (error) { log.error = String(error); await checkpoint(); console.error(error); process.exitCode = 1; }
