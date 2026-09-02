import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export class OceanDatabase {
  readonly raw: Database.Database;

  constructor(path: string, defaultWorkspacePath = process.cwd()) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path);
    this.raw.exec(SCHEMA_SQL);
    this.migrateModelSettings();
    this.migrateProjectHierarchy(resolve(defaultWorkspacePath));
  }

  private migrateModelSettings(): void {
    const columns = this.raw.prepare("PRAGMA table_info(model_provider_settings)").all() as Array<{ name: string }>;
    const ensureColumn = (name: string, definition: string) => {
      if (!columns.some((column) => column.name === name)) {
        this.raw.exec(`ALTER TABLE model_provider_settings ADD COLUMN ${name} ${definition}`);
      }
    };
    ensureColumn("catalog_json", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn("catalog_source", "TEXT");
    ensureColumn("catalog_discovered_at", "TEXT");
  }

  private migrateProjectHierarchy(defaultWorkspacePath: string): void {
    const projectColumns = this.raw.prepare("PRAGMA table_info(research_projects)").all() as Array<{ name: string }>;
    const ensureProjectColumn = (name: string, definition: string) => {
      if (!projectColumns.some((column) => column.name === name)) {
        this.raw.exec(`ALTER TABLE research_projects ADD COLUMN ${name} ${definition}`);
      }
    };
    ensureProjectColumn("execution_target", "TEXT NOT NULL DEFAULT 'local'");
    ensureProjectColumn("workspace_path", "TEXT NOT NULL DEFAULT ''");
    ensureProjectColumn("remote_connection_id", "TEXT");
    ensureProjectColumn("ssh_host", "TEXT");
    ensureProjectColumn("ssh_port", "INTEGER");
    ensureProjectColumn("ssh_username", "TEXT");
    this.raw.exec(
      "CREATE INDEX IF NOT EXISTS idx_projects_remote_connection ON research_projects(remote_connection_id)",
    );

    const columns = this.raw.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "project_id")) {
      this.raw.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT");
    }

    const projectCount = Number((this.raw.prepare(
      "SELECT COUNT(*) AS count FROM research_projects",
    ).get() as { count: number }).count);
    if (projectCount === 0) {
      const createdAt = new Date().toISOString();
      this.raw.prepare(`
        INSERT INTO research_projects (id, title, created_at, updated_at)
        VALUES ('oceanagent-default-project', 'OceanDataAgent', ?, ?)
      `).run(createdAt, createdAt);
    }
    const defaultProject = this.raw.prepare(
      "SELECT id FROM research_projects ORDER BY created_at ASC LIMIT 1",
    ).get() as { id: string };
    this.raw.prepare(
      "UPDATE conversations SET project_id = ? WHERE project_id IS NULL OR project_id = ''",
    ).run(defaultProject.id);
    this.raw.prepare(
      "UPDATE research_projects SET workspace_path = ? WHERE workspace_path IS NULL OR workspace_path = ''",
    ).run(defaultWorkspacePath);
    this.raw.exec(
      "CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at)",
    );
  }

  transaction<T>(operation: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}
