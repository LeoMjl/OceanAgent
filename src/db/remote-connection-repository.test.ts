import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretProtector } from "../security/dpapi-secret-protector.js";
import { OceanDatabase } from "./database.js";
import { RemoteConnectionRepository } from "./remote-connection-repository.js";

class TestProtector implements SecretProtector {
  async protect(secret: string): Promise<string> {
    return `sealed:${Buffer.from(secret).toString("base64")}`;
  }

  async unprotect(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.slice("sealed:".length), "base64").toString();
  }
}

describe("RemoteConnectionRepository", () => {
  let database: OceanDatabase;
  let repository: RemoteConnectionRepository;

  beforeEach(() => {
    database = new OceanDatabase(":memory:");
    repository = new RemoteConnectionRepository(database, new TestProtector());
  });

  afterEach(() => database.close());

  it("stores reusable connection metadata and an encrypted password", async () => {
    const profile = await repository.create({
      name: "实验室服务器", host: "10.0.0.8", port: 22, username: "ocean",
    }, "secret-password");

    expect(repository.list()[0]).toMatchObject({
      id: profile.id, name: "实验室服务器", host: "10.0.0.8", username: "ocean",
    });
    expect(await repository.getPassword(profile.id)).toBe("secret-password");
    const stored = database.raw.prepare(
      "SELECT secret_ciphertext FROM remote_connections WHERE id = ?",
    ).get(profile.id) as { secret_ciphertext: string };
    expect(stored.secret_ciphertext).not.toContain("secret-password");
  });

  it("updates a saved credential without changing its profile id", async () => {
    const profile = await repository.create({
      name: "GPU", host: "gpu.local", port: 2222, username: "researcher",
    }, "old-password");
    await repository.updatePassword(profile.id, "new-password");
    expect(await repository.getPassword(profile.id)).toBe("new-password");
    expect(repository.get(profile.id)?.id).toBe(profile.id);
  });
});
