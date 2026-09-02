import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app-context.js";
import { findApprovedPlan } from "./plan-approval.js";
import { firstQuestionTitle } from "./project-routes.js";
import type { ModelReference } from "../contracts.js";

interface IdParams {
  id: string;
}

export function registerConversationRoutes(server: FastifyInstance, context: AppContext): void {
  server.get("/api/conversations", async () => context.conversations.list());

  server.post<{ Body: { title?: string; projectId?: string } }>("/api/conversations", async (request, reply) => {
    const conversation = context.conversations.create(
      request.body?.title?.trim() || undefined,
      request.body?.projectId,
    );
    return reply.code(201).send(conversation);
  });

  server.get<{ Params: IdParams }>("/api/conversations/:id", async (request, reply) => {
    const conversation = context.conversations.get(request.params.id);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });
    const nodes = context.conversations.listNodes(conversation.id);
    const citations = Object.fromEntries(
      nodes.map((node) => [node.id, context.runs.listCitationsForNode(node.id)]),
    );
    const traces = Object.fromEntries(
      nodes.map((node) => [node.id, context.runs.listToolTracesForNode(node.id)]),
    );
    return {
      conversation,
      nodes,
      plans: context.plans.list(conversation.id),
      citations,
      traces,
    };
  });

  server.patch<{ Params: IdParams; Body: { title: string } }>(
    "/api/conversations/:id",
    async (request, reply) => {
      if (!request.body?.title?.trim()) return reply.code(400).send({ error: "标题不能为空" });
      const conversation = context.conversations.rename(request.params.id, request.body.title);
      return conversation ?? reply.code(404).send({ error: "会话不存在" });
    },
  );

  server.delete<{ Params: IdParams }>("/api/conversations/:id", async (request, reply) => {
    if (context.runs.findActive(request.params.id)) {
      return reply.code(409).send({ error: "当前会话正在运行，请先停止后再删除" });
    }
    if (!context.conversations.delete(request.params.id)) {
      return reply.code(404).send({ error: "会话不存在" });
    }
    return reply.code(204).send();
  });

  server.post<{ Params: IdParams; Body: { nodeId: string | null } }>(
    "/api/conversations/:id/active-node",
    async (request, reply) => {
      if (!context.conversations.get(request.params.id)) return reply.code(404).send({ error: "会话不存在" });
      context.conversations.setActiveNode(request.params.id, request.body.nodeId);
      return { ok: true, activeNodeId: request.body.nodeId };
    },
  );

  server.post<{
    Params: IdParams;
    Body: { content: string; parentId?: string | null; clarificationForNodeId?: string; model?: ModelReference };
  }>("/api/conversations/:id/messages", async (request, reply) => {
    const conversation = context.conversations.get(request.params.id);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });
    const content = request.body?.content?.trim();
    if (!content) return reply.code(400).send({ error: "消息不能为空" });
    const active = context.runs.findActive(conversation.id);
    if (active) return reply.code(409).send({ error: "当前会话已有正在运行的任务", runId: active.id });
    let runModel: string;
    try {
      runModel = context.models.runModelValue(request.body.model);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }

    const existingNodes = context.conversations.listNodes(conversation.id);
    const clarificationNodeId = request.body.clarificationForNodeId;
    if (clarificationNodeId) {
      const clarificationNode = context.conversations.getNode(clarificationNodeId);
      if (!clarificationNode || clarificationNode.conversationId !== conversation.id || clarificationNode.kind !== "clarification") {
        return reply.code(400).send({ error: "澄清表单不属于当前会话" });
      }
      if (request.body.parentId !== clarificationNodeId) {
        return reply.code(400).send({ error: "澄清表单必须接续对应的确认需求节点" });
      }
    }
    const parentId = request.body.parentId === undefined
      ? conversation.activeNodeId
      : request.body.parentId;
    const branchNodeIds = new Set(
      context.conversations.getBranch(conversation.id, parentId).map((node) => node.id),
    );
    const approvedPlan = clarificationNodeId
      ? null
      : findApprovedPlan(context.plans.list(conversation.id), branchNodeIds, content);
    const userNode = context.conversations.addNode({
      conversationId: conversation.id,
      parentId: request.body.parentId,
      role: "user",
      content,
      metadata: {
        ...(clarificationNodeId ? {
          uiHidden: true,
          clarificationForNodeId: clarificationNodeId,
        } : {}),
        ...(approvedPlan ? { approvedPlanId: approvedPlan.id } : {}),
        model: runModel,
      },
    });
    if (existingNodes.length === 0 && conversation.title === "新的海洋科研会话") {
      context.conversations.rename(conversation.id, firstQuestionTitle(content));
    }
    const run = context.runs.create(conversation.id, userNode.id, runModel);
    const executionPlan = approvedPlan
      ? context.plans.updateStatus(
        context.plans.updateStatus(approvedPlan.id, "approved").id,
        "executing",
      )
      : undefined;
    setImmediate(() => void context.runner.execute(run.id));
    return reply.code(202).send({
      run,
      userNode,
      plan: executionPlan,
      executionQueued: !!executionPlan,
      eventsUrl: `/api/runs/${run.id}/events`,
    });
  });
}
