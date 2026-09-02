import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { createAppContext } from "./app-context.js";
import { errorMessage } from "./http-errors.js";
import { registerConversationRoutes } from "./server/conversation-routes.js";
import { registerPlanRoutes } from "./server/plan-routes.js";
import { registerProjectRoutes } from "./server/project-routes.js";
import { registerRunRoutes } from "./server/run-routes.js";
import { ACTIVE_TOOL_NAMES } from "./agent/tools/index.js";
import { registerModelSettingsRoutes } from "./server/model-settings-routes.js";

const context = await createAppContext();
const server = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

await server.register(cors, {
  origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  credentials: true,
});

server.get("/api/health", async () => ({
  ok: true,
  name: "OceanAgent",
  model: context.models.getState().defaultModel,
  tools: ACTIVE_TOOL_NAMES,
  remoteExecution: {
    configured: context.remoteConnections.list().length > 0,
  },
  rag: context.rag.getStatus(),
}));

registerConversationRoutes(server, context);
registerProjectRoutes(server, context);
registerRunRoutes(server, context);
registerPlanRoutes(server, context);
registerModelSettingsRoutes(server, context);

if (existsSync(context.config.frontendDist)) {
  await server.register(fastifyStatic, {
    root: context.config.frontendDist,
  });
}

server.setErrorHandler((error, _request, reply) => {
  const candidate = (error as { statusCode?: number }).statusCode;
  const statusCode = candidate && candidate >= 400 ? candidate : 500;
  reply.code(statusCode).send({ error: errorMessage(error) });
});

const shutdown = async () => {
  await server.close();
  context.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: context.config.host, port: context.config.port });
