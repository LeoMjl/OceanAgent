import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

export function registerArtifactRoutes(server: FastifyInstance, root: string) {
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".pdf": "application/pdf", ".nc": "application/octet-stream" };
  server.get<{ Params: { runId: string; name: string } }>("/api/artifacts/:runId/:name", async (request, reply) => {
    const { runId, name } = request.params;
    if (!/^[a-f0-9-]{36}$/.test(runId) || !/^[\w.-]+$/.test(name) || name.includes("..")) return reply.code(404).send();
    const type = types[extname(name).toLowerCase()];
    if (!type) return reply.code(404).send();
    const file = resolve(root, runId, name);
    try { if (!(await stat(file)).isFile()) return reply.code(404).send(); }
    catch { return reply.code(404).send(); }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'");
    return reply.type(type).send(createReadStream(file));
  });
}
