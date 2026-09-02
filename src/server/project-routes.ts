import { mkdir, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { CreateResearchProjectInput, ResearchProject } from "../contracts.js";
import type { ModelReference } from "../contracts.js";
import type { AppContext } from "../app-context.js";
import { testRemoteConnection, type ProjectRemoteTarget } from "../agent/tools/run-remote-command.js";
import { pickLocalDirectory } from "../system/native-directory-picker.js";

interface IdParams {
  id: string;
}

export function firstQuestionTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, 20).join("");
}

function presentProject(context: AppContext, project: ResearchProject): ResearchProject {
  return {
    ...project,
    connectionStatus: project.executionTarget === "local"
      ? "local"
      : project.remoteConnectionId ? "saved"
        : context.projectCredentials.has(project.id) ? "connected" : "credentials_required",
  };
}

async function prepareLocalWorkspace(value: string): Promise<string> {
  const workspacePath = resolve(value.trim());
  if (!isAbsolute(value.trim())) throw new Error("本地项目目录必须是绝对路径");
  await mkdir(workspacePath, { recursive: true });
  const info = await stat(workspacePath);
  if (!info.isDirectory()) throw new Error("本地项目目录不是文件夹");
  return workspacePath;
}

function newRemoteTarget(input: CreateResearchProjectInput): ProjectRemoteTarget {
  const ssh = input.ssh;
  if (!ssh?.host?.trim() || !ssh.username?.trim() || !ssh.password) {
    throw new Error("请完整填写 SSH 主机、用户名和密码");
  }
  const port = ssh.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSH 端口必须在 1 至 65535 之间");
  }
  if (!input.workspacePath.trim().startsWith("/")) {
    throw new Error("远程项目目录必须是 Linux 绝对路径");
  }
  return {
    host: ssh.host.trim(),
    port,
    username: ssh.username.trim(),
    password: ssh.password,
    workspacePath: input.workspacePath.trim(),
  };
}

async function savedRemoteTarget(
  context: AppContext,
  connectionId: string,
  workspacePath: string,
): Promise<ProjectRemoteTarget> {
  const profile = context.remoteConnections.get(connectionId);
  if (!profile) throw new Error("选择的远程连接不存在，请刷新后重试");
  const password = await context.remoteConnections.getPassword(connectionId);
  if (!password) throw new Error("保存的远程连接没有可用凭据");
  if (!workspacePath.startsWith("/")) throw new Error("远程项目目录必须是 Linux 绝对路径");
  return { ...profile, password, workspacePath };
}

export function registerProjectRoutes(server: FastifyInstance, context: AppContext): void {
  server.get("/api/projects", async () => context.projects.list().map(
    (project) => presentProject(context, project),
  ));

  server.get("/api/remote-connections", async () => context.remoteConnections.list());

  server.post("/api/system/select-directory", async (_request, reply) => {
    try {
      return { path: await pickLocalDirectory() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ error: message });
    }
  });

  server.post<{ Body: Partial<CreateResearchProjectInput> }>("/api/projects", async (request, reply) => {
    const body = request.body ?? {};
    const executionTarget = body.executionTarget === "ssh" ? "ssh" : "local";
    const rawWorkspace = body.workspacePath?.trim() || context.config.rootDir;
    try {
      if (executionTarget === "local") {
        const workspacePath = await prepareLocalWorkspace(rawWorkspace);
        const project = context.projects.create({
          title: body.title?.trim() || basename(workspacePath),
          executionTarget,
          workspacePath,
        });
        return reply.code(201).send(presentProject(context, project));
      }
      const input = { ...body, executionTarget, workspacePath: rawWorkspace } as CreateResearchProjectInput;
      const selectedConnectionId = input.ssh?.connectionId?.trim();
      const target = selectedConnectionId
        ? await savedRemoteTarget(context, selectedConnectionId, rawWorkspace)
        : newRemoteTarget(input);
      await testRemoteConnection(context.config, target);
      const profile = selectedConnectionId
        ? context.remoteConnections.get(selectedConnectionId)!
        : await context.remoteConnections.create({
          name: input.ssh?.name?.trim() || `${target.username}@${target.host}`,
          host: target.host,
          port: target.port,
          username: target.username,
        }, target.password!);
      context.remoteConnections.markConnected(profile.id);
      const project = context.projects.create({
        title: body.title?.trim() || basename(target.workspacePath),
        executionTarget,
        workspacePath: target.workspacePath,
        ssh: {
          connectionId: profile.id,
          host: profile.host,
          port: profile.port,
          username: profile.username,
        },
      });
      context.projectCredentials.set(project.id, { password: target.password! });
      return reply.code(201).send(presentProject(context, project));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(executionTarget === "ssh" ? 502 : 400).send({ error: message });
    }
  });

  server.patch<{ Params: IdParams; Body: { title: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      if (!request.body?.title?.trim()) return reply.code(400).send({ error: "项目名称不能为空" });
      const project = context.projects.rename(request.params.id, request.body.title);
      return project ? presentProject(context, project) : reply.code(404).send({ error: "研究项目不存在" });
    },
  );

  server.post<{ Params: IdParams; Body: { password: string } }>(
    "/api/projects/:id/connect",
    async (request, reply) => {
      const project = context.projects.get(request.params.id);
      if (!project) return reply.code(404).send({ error: "研究项目不存在" });
      if (project.executionTarget !== "ssh") {
        return reply.code(400).send({ error: "本地项目不需要 SSH 连接" });
      }
      const password = request.body?.password;
      if (!password) return reply.code(400).send({ error: "SSH 密码不能为空" });
      const existingProfile = project.remoteConnectionId
        ? context.remoteConnections.get(project.remoteConnectionId)
        : null;
      const target: ProjectRemoteTarget = {
        host: existingProfile?.host ?? project.sshHost!,
        port: existingProfile?.port ?? project.sshPort ?? 22,
        username: existingProfile?.username ?? project.sshUsername!,
        password,
        workspacePath: project.workspacePath,
      };
      try {
        await testRemoteConnection(context.config, target);
        let connectedProject = project;
        if (existingProfile) {
          await context.remoteConnections.updatePassword(existingProfile.id, password);
        } else {
          const profile = await context.remoteConnections.create({
            name: `${target.username}@${target.host}`,
            host: target.host,
            port: target.port,
            username: target.username,
          }, password);
          connectedProject = context.projects.setRemoteConnection(project.id, profile.id, profile) ?? project;
        }
        context.projectCredentials.clear();
        context.projectCredentials.set(project.id, { password });
        return presentProject(context, connectedProject);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(502).send({ error: message });
      }
    },
  );

  server.delete<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    if (!context.projects.get(request.params.id)) {
      return reply.code(404).send({ error: "研究项目不存在" });
    }
    const conversations = context.conversations.list().filter(
      (conversation) => conversation.projectId === request.params.id,
    );
    if (conversations.some((conversation) => context.runs.findActive(conversation.id))) {
      return reply.code(409).send({ error: "项目中有正在运行的会话，请先停止后再删除" });
    }
    context.projects.delete(request.params.id);
    context.projectCredentials.delete(request.params.id);
    return reply.code(204).send();
  });

  server.post<{ Params: IdParams; Body: { content: string; model?: ModelReference } }>(
    "/api/projects/:id/messages",
    async (request, reply) => {
      if (!context.projects.get(request.params.id)) {
        return reply.code(404).send({ error: "研究项目不存在" });
      }
      const content = request.body?.content?.trim();
      if (!content) return reply.code(400).send({ error: "消息不能为空" });
      let runModel: string;
      try {
        runModel = context.models.runModelValue(request.body.model);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }

      const conversation = context.conversations.create(
        firstQuestionTitle(content),
        request.params.id,
      );
      const userNode = context.conversations.addNode({
        conversationId: conversation.id,
        parentId: null,
        role: "user",
        content,
      });
      const run = context.runs.create(
        conversation.id,
        userNode.id,
        runModel,
      );
      setImmediate(() => void context.runner.execute(run.id));
      return reply.code(202).send({
        conversation: context.conversations.get(conversation.id),
        run,
        userNode,
        eventsUrl: `/api/runs/${run.id}/events`,
      });
    },
  );
}
