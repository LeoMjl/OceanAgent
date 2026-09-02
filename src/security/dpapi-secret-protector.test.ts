import { describe, expect, it } from "vitest";
import { DpapiSecretProtector } from "./dpapi-secret-protector.js";

describe.skipIf(process.platform !== "win32")("DpapiSecretProtector", () => {
  it("round-trips a secret for the current Windows user", async () => {
    const protector = new DpapiSecretProtector();
    const secret = `OceanAgent-${Date.now()}-测试`;
    const ciphertext = await protector.protect(secret);
    expect(ciphertext).not.toContain(secret);
    expect(await protector.unprotect(ciphertext)).toBe(secret);
  }, 15_000);
});
