import type { FastifyInstance } from "fastify";
import type { ModelReference } from "../contracts.js";
import type { AppContext } from "../app-context.js";

interface ProviderParams {
  id: string;
}

export function registerModelSettingsRoutes(server: FastifyInstance, context: AppContext): void {
  server.get("/api/model-settings", async () => context.models.getState());

  server.post<{ Params: ProviderParams; Body: { apiKey?: string } }>(
    "/api/model-settings/providers/:id/discover",
    async (request, reply) => {
      try {
        return await context.models.discoverProvider(request.params.id, request.body?.apiKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    },
  );

  server.put<{
    Params: ProviderParams;
    Body: { apiKey?: string; modelIds?: string[] };
  }>("/api/model-settings/providers/:id", async (request, reply) => {
    try {
      return await context.models.saveProvider(
        request.params.id,
        request.body?.modelIds?.map(String) ?? [],
        request.body?.apiKey,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  server.patch<{ Body: { model?: ModelReference } }>(
    "/api/model-settings/default",
    async (request, reply) => {
      try {
        if (!request.body?.model) return reply.code(400).send({ error: "缺少模型" });
        return context.models.setDefaultModel(request.body.model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    },
  );
}
