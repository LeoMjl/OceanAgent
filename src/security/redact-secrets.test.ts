import { describe, expect, it } from "vitest";
import { redactSensitiveValues } from "./redact-secrets.js";

describe("redactSensitiveValues", () => {
  it("removes nested credentials and assignments embedded in commands", () => {
    const secret = "do-not-store-me";
    const redacted = redactSensitiveValues({
      password: secret,
      nested: { apiKey: secret },
      command: `client.connect(password='${secret}'); Authorization: Bearer ${secret}`,
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    expect(redactSensitiveValues(redacted)).toEqual(redacted);
    expect(redactSensitiveValues({ inputTokens: 42 })).toEqual({ inputTokens: 42 });
  });
});
