import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { OceanDatabase } from "../db/database.js";
import { ProjectRepository } from "../db/project-repository.js";
import { ConversationRepository } from "../db/conversation-repository.js";
import { PlanRepository } from "../db/plan-repository.js";
import { RunRepository } from "../db/run-repository.js";
import type { AppContext } from "../app-context.js";
import { registerResearchCaseRoutes, SST_CASE_ID } from "./research-case-routes.js";
import { registerPlanRoutes } from "./plan-routes.js";

function fixture(rootDir = process.cwd()) {
  const database = new OceanDatabase(":memory:");
  const runner = { execute: vi.fn(async () => {}) };
  const context = {
    database, config: { rootDir },
    projects: new ProjectRepository(database), conversations: new ConversationRepository(database),
    plans: new PlanRepository(database), runs: new RunRepository(database), runner,
    models: { runModelValue: vi.fn(() => "selected::model") },
  } as unknown as AppContext;
  const app = Fastify();
  registerResearchCaseRoutes(app, context); registerPlanRoutes(app, context);
  return { app, context, database, runner };
}

describe("research case activation", () => {
  it("starts model investigation without fabricating an assistant response or plan", async () => {
    const { app, context, database, runner } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/research-cases/south-china-sea-sst/activate", payload: {} });
      expect(response.statusCode, response.body).toBe(202);
      const { conversationId, run, eventsUrl } = response.json();
      expect(context.plans.list(conversationId)).toEqual([]);
      const nodes = context.conversations.listNodes(conversationId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.role).toBe("user");
      expect(nodes[0]!.metadata.researchCaseId).toBe(SST_CASE_ID);
      expect(nodes[0]!.content).not.toMatch(/run\.py|缓存|演示/);
      expect(run.model).toBe("selected::model");
      expect(eventsUrl).toBe(`/api/runs/${run.id}/events`);
      await new Promise((done) => setImmediate(done));
      expect(runner.execute).toHaveBeenCalledWith(run.id);
      expect(context.plans.list(conversationId)).toEqual([]);
    } finally { await app.close(); database.close(); }
  });
  it("does not offer a runnable plan when bundled resources are missing", async () => {
    const { app, context, database, runner } = fixture(resolve(process.cwd(), "missing-case-resources"));
    try {
      const response = await app.inject({ method: "POST", url: "/api/research-cases/south-china-sea-sst/activate", payload: {} });
      expect(response.statusCode).toBe(409);
      expect(context.conversations.list()).toHaveLength(0);
      expect(runner.execute).not.toHaveBeenCalled();
    } finally { await app.close(); database.close(); }
  });
});
