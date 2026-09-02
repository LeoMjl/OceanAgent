import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app-context.js";

interface IdParams {
  id: string;
}

export function registerPlanRoutes(server: FastifyInstance, context: AppContext): void {
  server.post<{ Params: IdParams }>("/api/plans/:id/approve", async (request, reply) => {
    const plan = context.plans.get(request.params.id);
    if (!plan) return reply.code(404).send({ error: "科研规划不存在" });
    if (plan.status !== "awaiting_approval") {
      return reply.code(409).send({ error: `当前规划状态为 ${plan.status}，不能重复确认` });
    }
    if (!plan.nodeId) return reply.code(409).send({ error: "科研规划尚未关联会话节点" });
    const active = context.runs.findActive(plan.conversationId);
    if (active) return reply.code(409).send({ error: "当前会话已有正在运行的任务", runId: active.id });

    const userNode = context.conversations.addNode({
      conversationId: plan.conversationId,
      parentId: plan.nodeId,
      role: "user",
      content: `已确认科研规划 v${plan.version}，请开始执行。`,
      metadata: { approvedPlanId: plan.id },
    });
    const previousModel = context.runs.latestForConversation(plan.conversationId)?.model;
    const run = context.runs.create(
      plan.conversationId,
      userNode.id,
      previousModel ?? context.models.runModelValue(),
    );
    context.plans.updateStatus(plan.id, "approved");
    const executingPlan = context.plans.updateStatus(plan.id, "executing");
    setImmediate(() => void context.runner.execute(run.id));
    return reply.code(202).send({
      plan: executingPlan,
      run,
      userNode,
      executionQueued: true,
      eventsUrl: `/api/runs/${run.id}/events`,
      message: "规划已确认，OceanAgent已开始执行当前工具能力范围内的步骤。",
    });
  });

  server.post<{ Params: IdParams }>("/api/plans/:id/reject", async (request, reply) => {
    const plan = context.plans.get(request.params.id);
    if (!plan) return reply.code(404).send({ error: "科研规划不存在" });
    if (plan.status !== "awaiting_approval") {
      return reply.code(409).send({ error: `当前规划状态为 ${plan.status}，不能拒绝` });
    }
    return { plan: context.plans.updateStatus(plan.id, "rejected") };
  });
}
