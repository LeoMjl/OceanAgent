import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createCompleteResearchPlanTool, workspaceFile } from "./complete-research-plan.js";
import { registerArtifactRoutes } from "../../server/artifact-routes.js";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("verified research delivery", () => {
  it("publishes actual outputs and serves a sandboxed report only after verification", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "ocean-delivery-")); directories.push(workspace);
    await writeFile(resolve(workspace, "report.html"), "<h1>Measured result</h1>");
    await writeFile(resolve(workspace, "verification.json"), JSON.stringify({ passed: true, checks: { measured: true }, artifacts: ["report.html"] }));
    const onComplete = vi.fn();
    const runId = "11111111-1111-1111-1111-111111111111";
    const publicationRoot = resolve(workspace, "published");
    const tool = createCompleteResearchPlanTool({ workspace, publicationRoot, runId, approved: true, local: true, onComplete });
    const result = await tool.execute("call", { verificationFile: "verification.json" }, undefined, undefined, {} as never);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(await readFile(resolve(publicationRoot, runId, "report.html"), "utf8")).toContain("Measured result");
    const app = Fastify(); registerArtifactRoutes(app, publicationRoot);
    try {
      const response = await app.inject(result.details.artifacts[0]!.url);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toContain("sandbox");
      expect((await app.inject("/api/artifacts/invalid/report.html")).statusCode).toBe(404);
    } finally { await app.close(); }
  });
  it("rejects missing approval, failed checks, missing files and paths outside the workspace", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "ocean-delivery-")); directories.push(workspace);
    const outside = await mkdtemp(resolve(tmpdir(), "ocean-outside-")); directories.push(outside);
    await writeFile(resolve(outside, "secret.txt"), "test");
    await expect(workspaceFile(workspace, resolve(outside, "secret.txt"))).rejects.toThrow("目录内");
    const config = { workspace, publicationRoot: resolve(workspace, "published"), runId: "test", local: true, onComplete: vi.fn() };
    const execute = (approved: boolean) => createCompleteResearchPlanTool({ ...config, approved })
      .execute("call", { verificationFile: "verification.json" }, undefined, undefined, {} as never);
    await expect(execute(false)).rejects.toThrow("确认");
    await writeFile(resolve(workspace, "verification.json"), JSON.stringify({ passed: true, checks: { actual: false }, artifacts: ["missing.html"] }));
    await expect(execute(true)).rejects.toThrow("未全部通过");
    await writeFile(resolve(workspace, "verification.json"), JSON.stringify({ passed: true, checks: { actual: true }, artifacts: ["missing.html"] }));
    await expect(execute(true)).rejects.toThrow();
    expect(config.onComplete).not.toHaveBeenCalled();
  });
});
