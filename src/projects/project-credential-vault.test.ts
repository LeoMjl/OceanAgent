import { describe, expect, it } from "vitest";
import { ProjectCredentialVault } from "./project-credential-vault.js";

describe("ProjectCredentialVault", () => {
  it("keeps SSH passwords only in memory and supports explicit cleanup", () => {
    const vault = new ProjectCredentialVault();
    vault.set("project-1", { password: "secret" });
    expect(vault.has("project-1")).toBe(true);
    expect(vault.get("project-1")?.password).toBe("secret");
    vault.delete("project-1");
    expect(vault.get("project-1")).toBeUndefined();
  });
});
