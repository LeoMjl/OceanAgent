import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app-context.js";
import type { StreamEvent } from "../contracts.js";

interface IdParams {
  id: string;
}

function isTerminal(type: StreamEvent["type"]): boolean {
  return type === "run.settled" || type === "run.error";
}

export function registerRunRoutes(server: FastifyInstance, context: AppContext): void {
  server.get<{ Params: IdParams; Querystring: { after?: string } }>(
    "/api/runs/:id/events",
    async (request, reply) => {
      const run = context.runs.get(request.params.id);
      if (!run) return reply.code(404).send({ error: "运行记录不存在" });

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders();

      let lastId = Number.parseInt(
        request.query.after ?? String(request.headers["last-event-id"] ?? "0"),
        10,
      ) || 0;
      let closedByServer = false;
      const send = (event: StreamEvent) => {
        if (reply.raw.writableEnded || (event.id ?? 0) <= lastId) return;
        lastId = event.id ?? lastId;
        reply.raw.write(`id: ${lastId}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        if (isTerminal(event.type)) {
          closedByServer = true;
          reply.raw.end();
        }
      };

      const unsubscribe = context.events.subscribe(run.id, send);
      for (const event of context.events.replay(run.id, lastId)) send(event);
      const current = context.runs.get(run.id);
      if (current && ["settled", "failed", "cancelled"].includes(current.status) && !reply.raw.writableEnded) {
        closedByServer = true;
        reply.raw.end();
      }
      const keepAlive = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(": keep-alive\n\n");
      }, 15_000);

      request.raw.once("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        if (!closedByServer) void context.runner.abort(run.id, "disconnect");
      });
    },
  );

  server.post<{ Params: IdParams }>("/api/runs/:id/abort", async (request, reply) => {
    const run = context.runs.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "运行记录不存在" });
    if (!["queued", "running"].includes(run.status)) {
      return reply.code(409).send({ error: `运行状态为 ${run.status}，无需停止` });
    }
    const stopped = await context.runner.abort(run.id, "user");
    return { stopped };
  });
}
