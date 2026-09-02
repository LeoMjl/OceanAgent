import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../config.js";
import type { ResearchPlan } from "../contracts.js";
import { ConversationRepository } from "../db/conversation-repository.js";
import { PlanRepository } from "../db/plan-repository.js";
import { RunRepository } from "../db/run-repository.js";
import { ProjectRepository } from "../db/project-repository.js";
import { RemoteConnectionRepository } from "../db/remote-connection-repository.js";
import { RunEventBus } from "../events/run-event-bus.js";
import { RagService } from "../rag/rag-service.js";
import { OfficialWebSearch } from "../web-search.js";
import { ProjectCredentialVault } from "../projects/project-credential-vault.js";
import { formatHistory } from "./history.js";
import { renderTerminalAction } from "./render-action.js";
import { OceanSessionFactory } from "./session-factory.js";
import { ToolAwareIdleTimer } from "./tool-aware-idle-timer.js";
import type { OceanToolContext, TerminalAction } from "./tool-context.js";
import { createOceanTools, OCEAN_TOOL_NAMES } from "./tools/index.js";

interface ActiveRun {
  conversationId: string;
  session: AgentSession;
  abortReason?: "user" | "disconnect" | "idle_timeout" | "hard_timeout";
}

export class OceanAgentRunner {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly config: AppConfig,
    private readonly sessions: OceanSessionFactory,
    private readonly conversations: ConversationRepository,
    private readonly runs: RunRepository,
    private readonly plans: PlanRepository,
    private readonly events: RunEventBus,
    private readonly rag: RagService,
    private readonly webSearch: OfficialWebSearch,
    private readonly projects: ProjectRepository,
    private readonly projectCredentials: ProjectCredentialVault,
    private readonly remoteConnections: RemoteConnectionRepository,
  ) {}

  async abort(runId: string, reason: ActiveRun["abortReason"] = "user"): Promise<boolean> {
    const active = this.active.get(runId);
    if (!active) return false;
    active.abortReason = reason;
    await active.session.abort();
    return true;
  }

  async execute(runId: string): Promise<void> {
    try {
      await this.executeInternal(runId);
    } catch (error) {
      const run = this.runs.get(runId);
      if (!run) throw error;
      if (run.status === "failed" || run.status === "cancelled" || run.status === "settled") return;
      await this.failRun(runId, run.userNodeId, error);
    }
  }

  private async executeInternal(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("运行记录不存在");
    const userNode = this.conversations.getNode(run.userNodeId);
    if (!userNode) throw new Error("用户消息节点不存在");
    const conversation = this.conversations.get(run.conversationId);
    if (!conversation) throw new Error("会话不存在");
    const project = this.projects.get(conversation.projectId);
    if (!project) throw new Error("研究项目不存在");
    let credential = project.executionTarget === "ssh"
      ? this.projectCredentials.get(project.id)
      : undefined;
    const profile = project.remoteConnectionId
      ? this.remoteConnections.get(project.remoteConnectionId)
      : null;
    if (project.executionTarget === "ssh" && !credential && profile) {
      const password = await this.remoteConnections.getPassword(profile.id);
      if (password) {
        credential = { password };
        this.projectCredentials.set(project.id, credential);
      }
    }
    if (project.executionTarget === "ssh" && !credential) {
      throw new Error("远程项目没有可用的 SSH 凭据，请从项目菜单重新连接服务器。");
    }
    const cwd = project.executionTarget === "local"
      ? project.workspacePath
      : resolve(this.config.rootDir, "data/remote-workspaces", project.id);
    await mkdir(cwd, { recursive: true });
    const remoteTarget = project.executionTarget === "ssh" ? {
      host: profile?.host ?? project.sshHost!,
      port: profile?.port ?? project.sshPort ?? 22,
      username: profile?.username ?? project.sshUsername!,
      password: credential!.password,
      workspacePath: project.workspacePath,
    } : undefined;
    const approvedPlanId = typeof userNode.metadata.approvedPlanId === "string"
      ? userNode.metadata.approvedPlanId
      : undefined;
    const approvedPlan = approvedPlanId ? this.plans.get(approvedPlanId) : null;
    let assistantText = "";
    let terminalAction: TerminalAction | undefined;
    const citationKeys = new Set<string>();
    const citationCounts = { ocean_rag: 0, web: 0 };

    const toolContext: OceanToolContext = {
      addCitation: (draft) => {
        const key = `${draft.sourceType}:${draft.sourceId}`;
        if (citationKeys.has(key)) return;
        const limit = draft.sourceType === "ocean_rag" ? 18 : 8;
        if (citationCounts[draft.sourceType] >= limit) return;
        citationKeys.add(key);
        citationCounts[draft.sourceType] += 1;
        const citation = this.runs.addCitation({ ...draft, runId });
        this.events.publish(runId, "citation.added", citation);
      },
      setTerminalAction: (action) => {
        terminalAction = action;
        if (action.type === "clarification") {
          this.events.publish(runId, "clarification.requested", action);
        } else {
          this.events.publish(runId, "plan.proposed", action.plan);
          this.events.publish(runId, "plan.awaiting_approval", { planId: action.plan.id });
        }
      },
      createPlan: (input) => {
        const plan: ResearchPlan = {
          ...input,
          id: randomUUID(),
          conversationId: run.conversationId,
          version: this.plans.nextVersion(run.conversationId),
          status: "awaiting_approval",
          createdAt: new Date().toISOString(),
        };
        return this.plans.save(plan);
      },
    };

    const manager = SessionManager.inMemory(cwd);
    manager.appendCustomMessageEntry("oceanagent_project", project.executionTarget === "ssh"
      ? `当前研究项目运行在远程 SSH 服务器 ${project.sshUsername}@${project.sshHost}:${project.sshPort ?? 22}，远程项目目录是 ${project.workspacePath}。所有远程科研命令只使用 run_remote_command；不要把凭据写进工具参数或回答。`
      : `当前研究项目的本地操作目录是 ${cwd}。所有 read、bash、edit、write 文件操作都应限制在该目录中。`, false);
    const history = formatHistory(this.conversations.getBranch(run.conversationId, userNode.parentId));
    if (history) manager.appendCustomMessageEntry("oceanagent_history", `以下是当前会话分支的历史记录：\n\n${history}`, false);
    const tools = createOceanTools(this.rag, this.webSearch, toolContext, this.config, remoteTarget);
    const activeToolNames = project.executionTarget === "ssh" ? OCEAN_TOOL_NAMES : undefined;
    const { session } = await this.sessions.createSession(manager, tools, cwd, activeToolNames, run.model);
    const active: ActiveRun = { conversationId: run.conversationId, session };
    this.active.set(runId, active);
    this.runs.update(runId, { status: "running" });
    this.events.publish(runId, "run.started", { model: run.model });

    const hardTimer = setTimeout(() => {
      active.abortReason = "hard_timeout";
      void session.abort();
    }, this.config.timeouts.hardMs);
    const idleTimer = new ToolAwareIdleTimer(this.config.timeouts.idleMs, () => {
      active.abortReason = "idle_timeout";
      void session.abort();
    });
    idleTimer.touch();
    const activeToolCalls = new Set<string>();
    let lastProgress = "";
    const publishProgress = (label: string, detail?: string) => {
      const key = `${label}:${detail ?? ""}`;
      if (key === lastProgress) return;
      lastProgress = key;
      this.events.publish(runId, "run.progress", { label, detail });
    };

    const unsubscribe = session.subscribe((event) => {
      try {
        if (event.type === "tool_execution_start") {
          activeToolCalls.add(event.toolCallId);
          idleTimer.toolStarted(event.toolCallId);
        } else if (event.type === "tool_execution_update") {
          idleTimer.toolUpdated(event.toolCallId);
        } else if (event.type === "tool_execution_end") {
          activeToolCalls.delete(event.toolCallId);
          idleTimer.toolEnded(event.toolCallId);
        } else {
          idleTimer.touch();
        }

        if (event.type === "message_update") {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta") {
            assistantText += update.delta;
            this.events.publish(runId, "message.delta", { delta: update.delta });
          } else if (update.type === "thinking_start") {
            publishProgress("正在推理下一步");
          } else if (update.type === "toolcall_start") {
            publishProgress("正在准备科研操作");
          } else if (update.type === "text_start") {
            publishProgress("正在整理阶段结果");
          }
        } else if (event.type === "turn_start") {
          publishProgress("正在分析下一步");
        } else if (event.type === "tool_execution_start") {
          lastProgress = "";
          this.runs.startToolCall(runId, event.toolCallId, event.toolName, event.args);
          const reasoning = event.toolName === "report_research_reasoning"
            && event.args && typeof event.args === "object"
            ? event.args as Record<string, unknown>
            : undefined;
          const detail = reasoning
            ? [reasoning.summary, reasoning.decision, reasoning.uncertainty]
              .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
              .join(" · ")
            : undefined;
          this.events.publish(runId, "tool.started", {
            id: event.toolCallId,
            name: event.toolName,
            ...(detail ? { detail } : {}),
          });
        } else if (event.type === "tool_execution_update") {
          this.events.publish(runId, "tool.progress", { id: event.toolCallId, name: event.toolName });
        } else if (event.type === "tool_execution_end") {
          this.runs.finishToolCall(event.toolCallId, event.result, event.isError);
          this.events.publish(runId, "tool.completed", { id: event.toolCallId, name: event.toolName, failed: event.isError });
          if (activeToolCalls.size === 0) publishProgress("正在分析工具结果");
        } else if (event.type === "auto_retry_start") {
          publishProgress("模型响应异常，正在自动重试");
        } else if (event.type === "compaction_start") {
          publishProgress("正在整理长会话上下文");
        } else if (event.type === "agent_settled") {
          publishProgress("正在保存研究结果");
        }
      } catch (error) {
        console.error("OceanAgent事件处理失败，Agent将继续运行：", error);
      }
    });

    try {
      const prompt = approvedPlan ? [
        "用户已经明确确认以下科研规划。现在进入执行阶段。",
        "请执行当前检索与分析能力可以真实完成的步骤，并给出阶段结果、证据和下一步产物。",
        "不得再次提出规划；避免重复询问，缺失的非关键参数使用显式假设。",
        "需要下载、代码运行或文件生成但当前工具无法完成的步骤，必须标记为待执行，不得声称已经完成。",
        `已批准规划：${JSON.stringify(approvedPlan)}`,
      ].join("\n") : userNode.content;
      await session.prompt(prompt);
      await this.finishRun(
        runId,
        userNode.id,
        assistantText,
        terminalAction,
        active.abortReason,
        approvedPlanId,
      );
    } catch (error) {
      await this.failRun(runId, userNode.id, error, approvedPlanId);
    } finally {
      idleTimer.dispose();
      clearTimeout(hardTimer);
      unsubscribe();
      session.dispose();
      this.active.delete(runId);
    }
  }

  private async finishRun(
    runId: string,
    userNodeId: string,
    text: string,
    action: TerminalAction | undefined,
    abortReason?: ActiveRun["abortReason"],
    approvedPlanId?: string,
  ): Promise<void> {
    const run = this.runs.get(runId)!;
    const content = action ? renderTerminalAction(action) : text || (abortReason ? "本次运行已停止。" : "OceanAgent没有生成可显示文本。");
    const kind = action?.type === "plan" ? "plan" : action?.type === "clarification" ? "clarification" : "message";
    const node = this.conversations.addNode({
      conversationId: run.conversationId,
      parentId: userNodeId,
      role: "assistant",
      kind,
      content,
      metadata: { runId, terminalAction: action, approvedPlanId },
    });
    if (action?.type === "plan") this.plans.attachNode(action.plan.id, node.id);
    this.runs.attachCitations(runId, node.id);
    const status = abortReason ? (abortReason.endsWith("timeout") ? "failed" : "cancelled") : "settled";
    this.runs.update(runId, { status, assistantNodeId: node.id, error: abortReason ?? null });
    if (approvedPlanId && status !== "settled") this.plans.updateStatus(approvedPlanId, "failed");
    const publicNode = { ...node, metadata: { runId, terminalAction: action } };
    if (status === "settled") this.events.publish(runId, "run.settled", { assistantNode: publicNode });
    else this.events.publish(runId, "run.error", { reason: abortReason, assistantNode: publicNode });
  }

  private async failRun(runId: string, userNodeId: string, error: unknown, approvedPlanId?: string): Promise<void> {
    const run = this.runs.get(runId)!;
    const userNode = this.conversations.getNode(userNodeId);
    const linkedPlanId = approvedPlanId ?? (
      typeof userNode?.metadata.approvedPlanId === "string" ? userNode.metadata.approvedPlanId : undefined
    );
    const message = error instanceof Error ? error.message : String(error);
    const node = this.conversations.addNode({
      conversationId: run.conversationId,
      parentId: userNodeId,
      role: "assistant",
      content: `运行失败：${message}`,
      metadata: { runId, error: message },
    });
    this.runs.update(runId, { status: "failed", assistantNodeId: node.id, error: message });
    if (linkedPlanId) this.plans.updateStatus(linkedPlanId, "failed");
    this.events.publish(runId, "run.error", { message, assistantNode: node });
  }
}
