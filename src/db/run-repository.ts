import { randomUUID } from "node:crypto";
import type { AgentRun, Citation, RunStatus, StreamEvent, ToolTrace } from "../contracts.js";
import { redactSensitiveValues, redactSerializedJson } from "../security/redact-secrets.js";
import { OceanDatabase } from "./database.js";

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function mapRun(row: Row): AgentRun {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    userNodeId: String(row.user_node_id),
    assistantNodeId: row.assistant_node_id ? String(row.assistant_node_id) : null,
    status: String(row.status) as RunStatus,
    model: String(row.model),
    error: row.error ? String(row.error) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    settledAt: row.settled_at ? String(row.settled_at) : null,
    createdAt: String(row.created_at),
  };
}

function toolDetail(value: unknown): string | undefined {
  try {
    const args = JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
    if (typeof args.summary === "string") {
      return [args.summary, args.decision, args.uncertainty]
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .join(" · ");
    }
    if (typeof args.query === "string") return args.query;
    if (typeof args.cardId === "string") return args.cardId;
    if (Array.isArray(args.datasetIds)) return args.datasetIds.map(String).join("、");
    if (typeof args.command === "string") return args.command.slice(0, 240);
    if (typeof args.objective === "string") return args.objective;
    if (Array.isArray(args.questions)) {
      return args.questions
        .map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).question ?? "") : "")
        .filter(Boolean)
        .join("；");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeNodeMetadata(value: string): string {
  try {
    const metadata = JSON.parse(value) as Record<string, unknown>;
    delete metadata.rawAssistantMessages;
    return JSON.stringify(redactSensitiveValues(metadata));
  } catch {
    return "{}";
  }
}

export class RunRepository {
  constructor(private readonly db: OceanDatabase) {}

  create(conversationId: string, userNodeId: string, model: string): AgentRun {
    const run: AgentRun = {
      id: randomUUID(),
      conversationId,
      userNodeId,
      assistantNodeId: null,
      status: "queued",
      model,
      error: null,
      startedAt: null,
      settledAt: null,
      createdAt: now(),
    };
    this.db.raw.prepare(`
      INSERT INTO runs
        (id, conversation_id, user_node_id, assistant_node_id, status, model, error, started_at, settled_at, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?)
    `).run(run.id, conversationId, userNodeId, run.status, model, run.createdAt);
    return run;
  }

  get(id: string): AgentRun | null {
    const row = this.db.raw.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? mapRun(row) : null;
  }

  findActive(conversationId: string): AgentRun | null {
    const row = this.db.raw.prepare(`
      SELECT * FROM runs
      WHERE conversation_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(conversationId) as Row | undefined;
    return row ? mapRun(row) : null;
  }

  latestForConversation(conversationId: string): AgentRun | null {
    const row = this.db.raw.prepare(`
      SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(conversationId) as Row | undefined;
    return row ? mapRun(row) : null;
  }

  update(id: string, update: {
    status: RunStatus;
    assistantNodeId?: string | null;
    error?: string | null;
  }): AgentRun {
    const existing = this.get(id);
    if (!existing) throw new Error("运行记录不存在");
    const startedAt = update.status === "running" && !existing.startedAt ? now() : existing.startedAt;
    const settledAt = ["settled", "failed", "cancelled"].includes(update.status) ? now() : existing.settledAt;
    this.db.raw.prepare(`
      UPDATE runs SET status = ?, assistant_node_id = ?, error = ?, started_at = ?, settled_at = ?
      WHERE id = ?
    `).run(
      update.status,
      update.assistantNodeId === undefined ? existing.assistantNodeId : update.assistantNodeId,
      update.error === undefined ? existing.error : update.error,
      startedAt,
      settledAt,
      id,
    );
    return this.get(id)!;
  }

  appendEvent<T>(event: StreamEvent<T>): StreamEvent<T> {
    const data = redactSensitiveValues(event.data) as T;
    const result = this.db.raw.prepare(`
      INSERT INTO events (run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)
    `).run(event.runId, event.type, JSON.stringify(data), event.createdAt);
    return { ...event, data, id: Number(result.lastInsertRowid) };
  }

  listEvents(runId: string, afterId = 0): StreamEvent[] {
    const rows = this.db.raw.prepare(`
      SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC
    `).all(runId, afterId) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      runId: String(row.run_id),
      type: String(row.type) as StreamEvent["type"],
      data: JSON.parse(String(row.payload_json)) as unknown,
      createdAt: String(row.created_at),
    }));
  }

  listToolTracesForNode(nodeId: string): ToolTrace[] {
    const rows = this.db.raw.prepare(`
      SELECT tool_calls.* FROM tool_calls
      JOIN runs ON runs.id = tool_calls.run_id
      WHERE runs.assistant_node_id = ? ORDER BY tool_calls.started_at ASC
    `).all(nodeId) as Row[];
    return rows
      .filter((row, index) => !(row.status === "failed" && rows.slice(index + 1).some(
        (later) => later.tool_name === row.tool_name && later.status === "completed",
      )))
      .map((row) => ({
        id: String(row.id),
        runId: String(row.run_id),
        name: String(row.tool_name),
        status: String(row.status) as ToolTrace["status"],
        detail: toolDetail(row.args_json),
        startedAt: String(row.started_at),
        finishedAt: row.finished_at ? String(row.finished_at) : undefined,
      }));
  }

  startToolCall(runId: string, id: string, name: string, args: unknown): void {
    this.db.raw.prepare(`
      INSERT OR REPLACE INTO tool_calls
        (id, run_id, tool_name, args_json, result_json, status, started_at, finished_at)
      VALUES (?, ?, ?, ?, NULL, 'running', ?, NULL)
    `).run(id, runId, name, JSON.stringify(redactSensitiveValues(args)), now());
  }

  finishToolCall(id: string, result: unknown, failed: boolean): void {
    this.db.raw.prepare(`
      UPDATE tool_calls SET result_json = ?, status = ?, finished_at = ? WHERE id = ?
    `).run(JSON.stringify(redactSensitiveValues(result)), failed ? "failed" : "completed", now(), id);
  }

  redactStoredSecrets(): number {
    return this.db.transaction(() => {
      let changed = 0;
      const toolRows = this.db.raw.prepare(
        "SELECT id, args_json, result_json FROM tool_calls",
      ).all() as Array<{ id: string; args_json: string; result_json: string | null }>;
      const updateTool = this.db.raw.prepare(
        "UPDATE tool_calls SET args_json = ?, result_json = ? WHERE id = ?",
      );
      for (const row of toolRows) {
        const args = redactSerializedJson(row.args_json);
        const result = row.result_json === null ? null : redactSerializedJson(row.result_json);
        if (args === row.args_json && result === row.result_json) continue;
        updateTool.run(args, result, row.id);
        changed += 1;
      }

      const nodeRows = this.db.raw.prepare(
        "SELECT id, metadata_json FROM nodes",
      ).all() as Array<{ id: string; metadata_json: string }>;
      const updateNode = this.db.raw.prepare("UPDATE nodes SET metadata_json = ? WHERE id = ?");
      for (const row of nodeRows) {
        const metadata = sanitizeNodeMetadata(row.metadata_json);
        if (metadata === row.metadata_json) continue;
        updateNode.run(metadata, row.id);
        changed += 1;
      }
      return changed;
    });
  }

  addCitation(input: Omit<Citation, "id">): Citation {
    const citation: Citation = { ...input, id: randomUUID() };
    this.db.raw.prepare(`
      INSERT INTO citations
        (id, node_id, run_id, source_type, source_id, title, locator, url, evidence_text, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      citation.id,
      citation.nodeId ?? null,
      citation.runId,
      citation.sourceType,
      citation.sourceId,
      citation.title,
      citation.locator ?? null,
      citation.url ?? null,
      citation.evidenceText ?? null,
      JSON.stringify(citation.metadata),
    );
    return citation;
  }

  attachCitations(runId: string, nodeId: string): void {
    this.db.raw.prepare("UPDATE citations SET node_id = ? WHERE run_id = ? AND node_id IS NULL").run(nodeId, runId);
  }

  listCitationsForNode(nodeId: string): Citation[] {
    const rows = this.db.raw.prepare("SELECT * FROM citations WHERE node_id = ?").all(nodeId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      nodeId: String(row.node_id),
      runId: String(row.run_id),
      sourceType: String(row.source_type) as Citation["sourceType"],
      sourceId: String(row.source_id),
      title: String(row.title),
      locator: row.locator ? String(row.locator) : undefined,
      url: row.url ? String(row.url) : undefined,
      evidenceText: row.evidence_text ? String(row.evidence_text) : undefined,
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
    }));
  }
}
