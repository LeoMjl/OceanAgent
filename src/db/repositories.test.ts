import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversation-repository.js";
import { OceanDatabase } from "./database.js";
import { PlanRepository } from "./plan-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { RunRepository } from "./run-repository.js";

describe("SQLite repositories", () => {
  let database: OceanDatabase;
  let conversations: ConversationRepository;
  let plans: PlanRepository;
  let projects: ProjectRepository;

  beforeEach(() => {
    database = new OceanDatabase(":memory:");
    projects = new ProjectRepository(database);
    conversations = new ConversationRepository(database);
    plans = new PlanRepository(database);
  });

  afterEach(() => database.close());

  it("groups named conversations under named research projects", () => {
    const project = projects.create("西北太平洋台风研究");
    const first = conversations.create("数据与方法", project.id);
    const second = conversations.create("实验设计", project.id);

    expect(first.projectId).toBe(project.id);
    expect(second.projectId).toBe(project.id);
    expect(projects.rename(project.id, "台风路径预报")?.title).toBe("台风路径预报");
    expect(conversations.rename(second.id, "消融实验")?.title).toBe("消融实验");
  });

  it("stores a project execution target without storing its SSH password", () => {
    const project = projects.create({
      title: "远程海洋实验",
      executionTarget: "ssh",
      workspacePath: "/data/ocean/experiment",
      ssh: { host: "research.example", port: 22, username: "ocean", password: "test-password-not-real" },
    });

    expect(project).toMatchObject({
      executionTarget: "ssh",
      workspacePath: "/data/ocean/experiment",
      sshHost: "research.example",
      sshUsername: "ocean",
    });
    const stored = database.raw.prepare(
      "SELECT * FROM research_projects WHERE id = ?",
    ).get(project.id) as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain("memory-only");
  });

  it("stores a conversation tree and resolves the selected branch", () => {
    const conversation = conversations.create("分支测试");
    const root = conversations.addNode({ conversationId: conversation.id, role: "user", content: "研究海温" });
    const first = conversations.addNode({ conversationId: conversation.id, role: "assistant", content: "第一种方案" });
    const branch = conversations.addNode({
      conversationId: conversation.id,
      parentId: root.id,
      role: "assistant",
      content: "第二种方案",
    });

    expect(conversations.listNodes(conversation.id)).toHaveLength(3);
    expect(conversations.getBranch(conversation.id, first.id).map((node) => node.id)).toEqual([root.id, first.id]);
    expect(conversations.getBranch(conversation.id, branch.id).map((node) => node.id)).toEqual([root.id, branch.id]);
    expect(conversations.get(conversation.id)?.activeNodeId).toBe(branch.id);
  });

  it("deletes a conversation tree without leaving child nodes", () => {
    const conversation = conversations.create("待删除会话");
    const root = conversations.addNode({ conversationId: conversation.id, role: "user", content: "问题" });
    conversations.addNode({ conversationId: conversation.id, parentId: root.id, role: "assistant", content: "回答" });

    expect(conversations.delete(conversation.id)).toBe(true);
    expect(conversations.get(conversation.id)).toBeNull();
    expect(conversations.listNodes(conversation.id)).toEqual([]);
  });

  it("deletes a project together with its conversations and nodes", () => {
    const project = projects.create("待删除项目");
    const conversation = conversations.create("项目会话", project.id);
    const root = conversations.addNode({ conversationId: conversation.id, role: "user", content: "问题" });
    conversations.addNode({ conversationId: conversation.id, parentId: root.id, role: "assistant", content: "回答" });
    const runs = new RunRepository(database);
    const run = runs.create(conversation.id, root.id, "test-model");

    expect(projects.delete(project.id)).toBe(true);
    expect(projects.get(project.id)).toBeNull();
    expect(conversations.get(conversation.id)).toBeNull();
    expect(conversations.listNodes(conversation.id)).toEqual([]);
    expect(runs.get(run.id)).toBeNull();
  });

  it("persists and approves a versioned research plan", () => {
    const conversation = conversations.create();
    const plan = plans.save({
      id: "plan-1",
      conversationId: conversation.id,
      version: plans.nextVersion(conversation.id),
      status: "awaiting_approval",
      objective: "构建海温预测模型",
      assumptions: [],
      requiredInputs: ["时间范围"],
      datasets: ["OISST"],
      evidenceNeeds: [],
      steps: [{
        id: "S1",
        title: "数据准备",
        description: "下载并质控数据",
        dependsOn: [],
        expectedOutputs: ["数据集"],
        risks: [],
      }],
      deliverables: ["报告"],
      risks: [],
      createdAt: new Date().toISOString(),
    });

    expect(plan.version).toBe(1);
    expect(plans.nextVersion(conversation.id)).toBe(2);
    expect(plans.updateStatus(plan.id, "approved").status).toBe("approved");
    expect(plans.get(plan.id)?.approvedAt).toBeTruthy();
  });

  it("redacts credentials from new and historical execution traces", () => {
    const secret = "never-store-this";
    const conversation = conversations.create("凭据脱敏");
    const node = conversations.addNode({
      conversationId: conversation.id,
      role: "user",
      content: "运行远程命令",
    });
    const runs = new RunRepository(database);
    const run = runs.create(conversation.id, node.id, "test-model");
    runs.startToolCall(run.id, "tool-new", "bash", {
      command: `connect(password='${secret}')`,
      password: secret,
    });
    const fresh = database.raw.prepare(
      "SELECT args_json FROM tool_calls WHERE id = 'tool-new'",
    ).get() as { args_json: string };
    expect(fresh.args_json).not.toContain(secret);

    database.raw.prepare("UPDATE tool_calls SET args_json = ? WHERE id = 'tool-new'").run(
      JSON.stringify({ password: secret }),
    );
    database.raw.prepare("UPDATE nodes SET metadata_json = ? WHERE id = ?").run(
      JSON.stringify({ rawAssistantMessages: [{ command: `password=${secret}` }] }),
      node.id,
    );
    expect(runs.redactStoredSecrets()).toBe(2);

    const stored = database.raw.prepare(
      "SELECT args_json FROM tool_calls WHERE id = 'tool-new'",
    ).get() as { args_json: string };
    expect(stored.args_json).not.toContain(secret);
    expect(JSON.stringify(conversations.getNode(node.id)?.metadata)).not.toContain(secret);
  });

  it("renders a persisted model reasoning summary in the research trace", () => {
    const conversation = conversations.create("推理摘要");
    const user = conversations.addNode({ conversationId: conversation.id, role: "user", content: "分析海温" });
    const assistant = conversations.addNode({ conversationId: conversation.id, parentId: user.id, role: "assistant", content: "回答" });
    const runs = new RunRepository(database);
    const run = runs.create(conversation.id, user.id, "test-model");
    runs.startToolCall(run.id, "reasoning-1", "report_research_reasoning", {
      stage: "knowledge_routing",
      summary: "问题属于物理海洋学，先检索相似研究。",
      decision: "查询 D0601。",
      uncertainty: "时间范围尚未明确。",
    });
    runs.finishToolCall("reasoning-1", {}, false);
    runs.update(run.id, { status: "settled", assistantNodeId: assistant.id });

    expect(runs.listToolTracesForNode(assistant.id)[0]?.detail).toContain("查询 D0601");
  });
});
