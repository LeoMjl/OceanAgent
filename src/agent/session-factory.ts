import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createAgentSession,
  createBashToolDefinition,
  createLocalPowerShellOperations,
  DefaultResourceLoader,
  type SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../config.js";
import { OceanModelService } from "./model-service.js";
import { ACTIVE_TOOL_NAMES } from "./tools/index.js";

export function createPlatformCoreToolOverrides(rootDir: string): ToolDefinition<any, any, any>[] {
  if (process.platform !== "win32") return [];
  return [createBashToolDefinition(rootDir, {
    operations: createLocalPowerShellOperations(),
  })];
}

export class OceanSessionFactory {
  private constructor(
    private readonly config: AppConfig,
    private readonly systemPrompt: string,
    private readonly models: OceanModelService,
  ) {}

  static async create(config: AppConfig, models: OceanModelService): Promise<OceanSessionFactory> {
    const systemPrompt = await readFile(resolve(config.rootDir, ".pi/SYSTEM.md"), "utf8");
    return new OceanSessionFactory(config, systemPrompt, models);
  }

  async createSession(
    sessionManager: SessionManager,
    customTools: ToolDefinition[],
    cwd = this.config.rootDir,
    activeToolNames: readonly string[] = ACTIVE_TOOL_NAMES,
    modelValue?: string,
  ) {
    const agentDir = resolve(this.config.rootDir, "data/pi-runtime");
    await mkdir(agentDir, { recursive: true });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      systemPromptOverride: () => this.systemPrompt,
      appendSystemPromptOverride: () => [],
      noContextFiles: true,
      noSkills: true,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await loader.reload();
    const model = this.models.resolveRunModel(modelValue);
    const scopedModels = this.models.enabledModels().map((item) => ({
      model: this.models.runtime.getModel(item.providerId, item.modelId)!,
      thinkingLevel: "medium" as const,
    }));
    return createAgentSession({
      cwd,
      agentDir,
      modelRuntime: this.models.runtime,
      model,
      scopedModels,
      thinkingLevel: "medium",
      tools: [...activeToolNames],
      customTools: [...createPlatformCoreToolOverrides(cwd), ...customTools],
      resourceLoader: loader,
      sessionManager,
    });
  }
}
