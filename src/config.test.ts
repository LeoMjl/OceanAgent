import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not load project .env files", () => {
    const directory = mkdtempSync(join(tmpdir(), "ocean-agent-config-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, ".env"), "PORT=9876\nDASHSCOPE_API_KEY=must-not-load\n");
    const previousPort = process.env.PORT;
    delete process.env.PORT;
    try {
      expect(loadConfig(directory).port).toBe(3210);
      expect(process.env.DASHSCOPE_API_KEY).not.toBe("must-not-load");
    } finally {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
    }
  });

  it("anchors persistent paths to the installation directory by default", () => {
    const expectedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const config = loadConfig();

    expect(config.rootDir).toBe(expectedRoot);
    expect(config.databasePath).toBe(join(expectedRoot, "data", "ocean-agent.sqlite"));
    expect(config.ragRoot).toBe(join(expectedRoot, "Ocean-RAG"));
  });
});
