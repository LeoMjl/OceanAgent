import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createBashTool,
  createEditTool,
  createLocalPowerShellOperations,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((item) => item.type === "text" ? item.text ?? "" : "").join("\n");
}

async function removeWorkspace(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rmdir(path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" || attempt === 9) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
}

describe("Pi core tools", () => {
  it("can write, edit, read, and run a shell command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oceanagent-pi-tools-"));
    const target = resolve(workspace, "smoke.txt");
    try {
      const write = await createWriteTool(workspace).execute("write-smoke", {
        path: target,
        content: "alpha\n",
      });
      expect(textOf(write)).toContain("Successfully wrote");

      await createEditTool(workspace).execute("edit-smoke", {
        path: target,
        edits: [{ oldText: "alpha", newText: "beta" }],
      });
      const read = await createReadTool(workspace).execute("read-smoke", { path: target });
      expect(textOf(read)).toContain("beta");

      const bashOptions = process.platform === "win32"
        ? { operations: createLocalPowerShellOperations() }
        : undefined;
      const bash = await createBashTool(workspace, bashOptions).execute("bash-smoke", {
        command: process.platform === "win32" ? "Write-Output bash-ok" : "printf bash-ok",
      });
      expect(textOf(bash)).toContain("bash-ok");
    } finally {
      await rm(target, { force: true });
      await removeWorkspace(workspace);
    }
  });
});
