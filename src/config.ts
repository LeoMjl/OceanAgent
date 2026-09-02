import { resolve } from "node:path";

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveFromRoot(root: string, value: string): string {
  return resolve(root, value);
}

export interface AppConfig {
  rootDir: string;
  host: string;
  port: number;
  databasePath: string;
  ragRoot: string;
  frontendDist: string;
  timeouts: {
    idleMs: number;
    hardMs: number;
  };
  remoteSsh: {
    pythonPath: string;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    strictHostKey: boolean;
  };
}

export function loadConfig(rootDir = process.cwd()): AppConfig {
  return {
    rootDir,
    host: process.env.HOST ?? "127.0.0.1",
    port: intFromEnv("PORT", 3210),
    databasePath: resolveFromRoot(rootDir, process.env.OCEAN_DB_PATH ?? "data/ocean-agent.sqlite"),
    ragRoot: resolveFromRoot(rootDir, process.env.OCEAN_RAG_ROOT ?? "Ocean-RAG"),
    frontendDist: resolveFromRoot(rootDir, "frontend/dist"),
    timeouts: {
      idleMs: intFromEnv("CHAT_IDLE_TIMEOUT_MS", 120_000),
      hardMs: intFromEnv("CHAT_HARD_TIMEOUT_MS", 1_800_000),
    },
    remoteSsh: {
      pythonPath: process.env.OCEAN_PYTHON_PATH ?? "python",
      connectTimeoutMs: intFromEnv("OCEAN_SSH_CONNECT_TIMEOUT_MS", 20_000),
      commandTimeoutMs: intFromEnv("OCEAN_SSH_COMMAND_TIMEOUT_MS", 900_000),
      strictHostKey: process.env.OCEAN_SSH_STRICT_HOST_KEY === "true",
    },
  };
}
