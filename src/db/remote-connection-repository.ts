import { randomUUID } from "node:crypto";
import type { RemoteConnectionProfile } from "../contracts.js";
import type { SecretProtector } from "../security/dpapi-secret-protector.js";
import { OceanDatabase } from "./database.js";

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function mapProfile(row: Row): RemoteConnectionProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    host: String(row.host),
    port: Number(row.port),
    username: String(row.username),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastConnectedAt: row.last_connected_at ? String(row.last_connected_at) : undefined,
  };
}

export class RemoteConnectionRepository {
  constructor(
    private readonly db: OceanDatabase,
    private readonly protector: SecretProtector,
  ) {}

  list(): RemoteConnectionProfile[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM remote_connections ORDER BY updated_at DESC",
    ).all() as Row[];
    return rows.map(mapProfile);
  }

  get(id: string): RemoteConnectionProfile | null {
    const row = this.db.raw.prepare(
      "SELECT * FROM remote_connections WHERE id = ?",
    ).get(id) as Row | undefined;
    return row ? mapProfile(row) : null;
  }

  async create(
    input: Pick<RemoteConnectionProfile, "name" | "host" | "port" | "username">,
    password: string,
  ): Promise<RemoteConnectionProfile> {
    const id = randomUUID();
    const timestamp = now();
    const ciphertext = await this.protector.protect(password);
    this.db.raw.prepare(`
      INSERT INTO remote_connections
        (id, name, host, port, username, secret_ciphertext, created_at, updated_at, last_connected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.host, input.port, input.username, ciphertext, timestamp, timestamp, timestamp);
    return this.get(id)!;
  }

  async getPassword(id: string): Promise<string | null> {
    const row = this.db.raw.prepare(
      "SELECT secret_ciphertext FROM remote_connections WHERE id = ?",
    ).get(id) as { secret_ciphertext: string } | undefined;
    return row ? this.protector.unprotect(row.secret_ciphertext) : null;
  }

  async updatePassword(id: string, password: string): Promise<void> {
    const ciphertext = await this.protector.protect(password);
    const timestamp = now();
    this.db.raw.prepare(`
      UPDATE remote_connections
      SET secret_ciphertext = ?, updated_at = ?, last_connected_at = ?
      WHERE id = ?
    `).run(ciphertext, timestamp, timestamp, id);
  }

  markConnected(id: string): void {
    const timestamp = now();
    this.db.raw.prepare(`
      UPDATE remote_connections SET last_connected_at = ?, updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, id);
  }
}
