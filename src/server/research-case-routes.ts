import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app-context.js";
import type { ModelReference } from "../contracts.js";

export const SST_CASE_ID = "south-china-sea-sst";
export const SST_PLANNING_INSTRUCTIONS = [
  "先进行真实的研究准备与规划。用户尚未批准计算，不要运行分析、绘图或报告生成步骤。",
  "先简短说明准备检查什么，再用工具查看工作区的数据与工具，包括 case.json、数据目录和脚本接口。",
  "未查看文件前不得声称找到缓存；区分文件存在、元数据匹配与数据质量已验证。不要读取历史结果冒充本次分析。",
  "每完成一组调查，向用户简短说明观察到的事实、方法选择依据和仍待验证的问题。这些是公开的进度说明，不需要提供内部思维链。",
  "根据实际观察自行制定步骤、依赖、统计方法和交付物，调用 propose_research_plan 等待确认。不要复制说明文档中的现成方案。",
  "方案必须明确协作分工：数据准备完成后，创建数据质量核验与海温距平统计两个子智能体并行工作；主智能体汇总后负责绘图、报告、独立复核与交付。确认前不启动这两个执行子任务。",
  "用户已明确日期、区域和成果，常规技术细节合理选择；有实质冲突再询问。界面说明聚焦科研问题，不必罗列脚本路径。",
].join("\n");

export const SST_EXECUTION_INSTRUCTIONS = [
  "执行用户已确认的海温研究方案。",
  "当前项目目录为案例工作区。读取 case.json 与 run.py 确认调用方式，复用现有脚本，不改写。",
  "创建唯一输出目录 runs/analysis-时间戳，所有命令使用相同 --out。",
  "主智能体先运行 python run.py prepare --mode cache，每步附加相同 --out。",
  "prepare 成功后必须调用 subagent 工具，一次传入两个任务：数据质量核验子智能体执行 quality；海温距平统计子智能体执行 analyze。不得只用两条 bash 命令代替创建子智能体。",
  "向两个子智能体传递工作目录、本次输出目录和完整命令；只读共享输入，各自生成自己的产物，不修改共享脚本。启动前向用户说明分工。",
  "等待两个子任务返回并检查结果；失败时如实说明并修复，不得宣称协作成功。两者成功后由主智能体按顺序执行 plot、report、verify，再汇总交付。",
  "读取本次 verification.json，全部通过后调用 complete_research_plan，verificationFile 指向该文件。",
  "只交付本次实际产物，失败时修复或如实说明。最终给出中文结论与返回的报告、图表、数据链接。",
].join("\n");

export function registerResearchCaseRoutes(server: FastifyInstance, context: AppContext): void {
  server.post<{ Body: { model?: ModelReference } }>("/api/research-cases/south-china-sea-sst/activate", async (request, reply) => {
    let model: string;
    try { model = context.models.runModelValue(request.body?.model); }
    catch (error) { return reply.code(400).send({ error: String(error) }); }
    const workspacePath = resolve(context.config.rootDir, "demos/sst-analysis");
    try { await stat(workspacePath); }
    catch { return reply.code(409).send({ error: "研究工作区不存在，请检查项目资源。" }); }
    const project = context.projects.list().find((item) => item.executionTarget === "local"
      && resolve(item.workspacePath) === workspacePath)
      ?? context.projects.create({ title: "南海海温分析", executionTarget: "local", workspacePath });
    const conversation = context.conversations.create("南海海表温度与异常分析", project.id);
    const userNode = context.conversations.addNode({
      conversationId: conversation.id, role: "user",
      content: "请分析2019年7月15日南海及邻近海域（105–125°E、5–25°N）的海表温度与异常，计算平均海温、平均距平及距平大于1°C的海域面积占比，生成分布图和中文报告。请先调查数据条件并制定方案，等我确认后再执行分析。",
      metadata: { researchCaseId: SST_CASE_ID },
    });
    const run = context.runs.create(conversation.id, userNode.id, model);
    setImmediate(() => void context.runner.execute(run.id));
    return reply.code(202).send({ conversationId: conversation.id, run, eventsUrl: `/api/runs/${run.id}/events` });
  });
}
