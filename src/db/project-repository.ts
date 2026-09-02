import { randomUUID } from "node:crypto";
import type { CreateResearchProjectInput, ResearchProject } from "../contracts.js";
import { OceanDatabase } from "./database.js";

type Row = Record<string, unknown>;

export const DEFAULT_PROJECT_ID = "oceanagent-default-project";

function now(): string {
  return new Date().toISOString();
}

function mapProject(row: Row): ResearchProject {
  return {
    id: String(row.id),
    title: String(row.title),
    executionTarget: row.execution_target === "ssh" ? "ssh" : "local",
    workspacePath: String(row.workspace_path ?? ""),
    remoteConnectionId: row.remote_connection_id ? String(row.remote_connection_id) : undefined,
    sshHost: row.ssh_host ? String(row.ssh_host) : undefined,
    sshPort: row.ssh_port ? Number(row.ssh_port) : undefined,
    sshUsername: row.ssh_username ? String(row.ssh_username) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ProjectRepository {
  constructor(private readonly db: OceanDatabase) {}

  ensureDefault(): ResearchProject {
    const existing = this.get(DEFAULT_PROJECT_ID);
    if (existing) return existing;
    const first = this.list()[0];
    if (first) return first;
    const createdAt = now();
    this.db.raw.prepare(`
      INSERT INTO research_projects (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(DEFAULT_PROJECT_ID, "OceanDataAgent", createdAt, createdAt);
    return this.get(DEFAULT_PROJECT_ID)!;
  }

  create(input: string | CreateResearchProjectInput = "未命名研究项目"): ResearchProject {
    const createdAt = now();
    const normalized = typeof input === "string" ? {
      title: input,
      executionTarget: "local" as const,
      workspacePath: process.cwd(),
    } : input;
    const project: ResearchProject = {
      id: randomUUID(),
      title: normalized.title.trim().slice(0, 120) || "未命名研究项目",
      executionTarget: normalized.executionTarget,
      workspacePath: normalized.workspacePath,
      remoteConnectionId: normalized.ssh?.connectionId,
      sshHost: normalized.ssh?.host,
      sshPort: normalized.ssh?.port,
      sshUsername: normalized.ssh?.username,
      createdAt,
      updatedAt: createdAt,
    };
    this.db.raw.prepare(`
      INSERT INTO research_projects
        (id, title, execution_target, workspace_path, remote_connection_id,
         ssh_host, ssh_port, ssh_username, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.title,
      project.executionTarget,
      project.workspacePath,
      project.remoteConnectionId ?? null,
      project.sshHost ?? null,
      project.sshPort ?? null,
      project.sshUsername ?? null,
      project.createdAt,
      project.updatedAt,
    );
    return project;
  }

  list(): ResearchProject[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM research_projects ORDER BY updated_at DESC",
    ).all() as Row[];
    return rows.map(mapProject);
  }

  get(id: string): ResearchProject | null {
    const row = this.db.raw.prepare(
      "SELECT * FROM research_projects WHERE id = ?",
    ).get(id) as Row | undefined;
    return row ? mapProject(row) : null;
  }

  rename(id: string, title: string): ResearchProject | null {
    this.db.raw.prepare(
      "UPDATE research_projects SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title.trim().slice(0, 120), now(), id);
    return this.get(id);
  }

  setRemoteConnection(
    id: string,
    connectionId: string,
    profile: { host: string; port: number; username: string },
  ): ResearchProject | null {
    this.db.raw.prepare(`
      UPDATE research_projects
      SET remote_connection_id = ?, ssh_host = ?, ssh_port = ?, ssh_username = ?, updated_at = ?
      WHERE id = ?
    `).run(connectionId, profile.host, profile.port, profile.username, now(), id);
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.transaction(() => {
      this.db.raw.prepare(`
        UPDATE nodes SET parent_id = NULL
        WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)
      `).run(id);
      this.db.raw.prepare("DELETE FROM conversations WHERE project_id = ?").run(id);
      return this.db.raw.prepare("DELETE FROM research_projects WHERE id = ?").run(id);
    });
    return result.changes > 0;
  }

  touch(id: string): void {
    this.db.raw.prepare(
      "UPDATE research_projects SET updated_at = ? WHERE id = ?",
    ).run(now(), id);
  }
}
