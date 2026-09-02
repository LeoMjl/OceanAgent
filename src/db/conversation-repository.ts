import { randomUUID } from "node:crypto";
import type { Conversation, ConversationNode, NodeKind, NodeRole } from "../contracts.js";
import { redactSensitiveValues } from "../security/redact-secrets.js";
import { OceanDatabase } from "./database.js";

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    activeNodeId: row.active_node_id ? String(row.active_node_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapNode(row: Row): ConversationNode {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    role: String(row.role) as NodeRole,
    kind: String(row.kind) as NodeKind,
    content: String(row.content),
    metadata: parseJson(row.metadata_json),
    createdAt: String(row.created_at),
  };
}

export class ConversationRepository {
  constructor(private readonly db: OceanDatabase) {}

  create(title = "新的海洋科研会话", projectId?: string): Conversation {
    const createdAt = now();
    const targetProject = projectId
      ? this.db.raw.prepare("SELECT id FROM research_projects WHERE id = ?").get(projectId) as Row | undefined
      : this.db.raw.prepare("SELECT id FROM research_projects ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined;
    if (!targetProject) throw new Error("研究项目不存在");
    const conversation: Conversation = {
      id: randomUUID(),
      projectId: String(targetProject.id),
      title,
      activeNodeId: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.db.raw.prepare(`
      INSERT INTO conversations (id, project_id, title, active_node_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(conversation.id, conversation.projectId, conversation.title, createdAt, createdAt);
    this.touchProject(conversation.projectId, createdAt);
    return conversation;
  }

  list(): Conversation[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM conversations ORDER BY updated_at DESC",
    ).all() as Row[];
    return rows.map(mapConversation);
  }

  get(id: string): Conversation | null {
    const row = this.db.raw.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return row ? mapConversation(row) : null;
  }

  rename(id: string, title: string): Conversation | null {
    const updatedAt = now();
    this.db.raw.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title.trim().slice(0, 120), updatedAt, id);
    const conversation = this.get(id);
    if (conversation) this.touchProject(conversation.projectId, updatedAt);
    return conversation;
  }

  delete(id: string): boolean {
    const conversation = this.get(id);
    if (!conversation) return false;
    const result = this.db.transaction(() => {
      this.db.raw.prepare("UPDATE nodes SET parent_id = NULL WHERE conversation_id = ?").run(id);
      return this.db.raw.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    });
    this.touchProject(conversation.projectId, now());
    return result.changes > 0;
  }

  addNode(input: {
    conversationId: string;
    parentId?: string | null;
    role: NodeRole;
    kind?: NodeKind;
    content: string;
    metadata?: Record<string, unknown>;
    setActive?: boolean;
  }): ConversationNode {
    const conversation = this.get(input.conversationId);
    if (!conversation) throw new Error("会话不存在");

    const parentId = input.parentId === undefined ? conversation.activeNodeId : input.parentId;
    if (parentId) {
      const parent = this.getNode(parentId);
      if (!parent || parent.conversationId !== input.conversationId) {
        throw new Error("父节点不属于当前会话");
      }
    }

    const node: ConversationNode = {
      id: randomUUID(),
      conversationId: input.conversationId,
      parentId: parentId ?? null,
      role: input.role,
      kind: input.kind ?? "message",
      content: input.content,
      metadata: redactSensitiveValues(input.metadata ?? {}) as Record<string, unknown>,
      createdAt: now(),
    };

    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO nodes
          (id, conversation_id, parent_id, role, kind, content, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.id,
        node.conversationId,
        node.parentId,
        node.role,
        node.kind,
        node.content,
        JSON.stringify(node.metadata),
        node.createdAt,
      );
      if (input.setActive !== false) {
        this.db.raw.prepare(`
          UPDATE conversations SET active_node_id = ?, updated_at = ? WHERE id = ?
        `).run(node.id, node.createdAt, node.conversationId);
        this.touchProject(conversation.projectId, node.createdAt);
      }
    });
    return node;
  }

  getNode(id: string): ConversationNode | null {
    const row = this.db.raw.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined;
    return row ? mapNode(row) : null;
  }

  listNodes(conversationId: string): ConversationNode[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM nodes WHERE conversation_id = ? ORDER BY created_at ASC",
    ).all(conversationId) as Row[];
    return rows.map(mapNode);
  }

  getBranch(conversationId: string, leafId: string | null): ConversationNode[] {
    if (!leafId) return [];
    const nodes = this.listNodes(conversationId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const branch: ConversationNode[] = [];
    let cursor: ConversationNode | undefined = byId.get(leafId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      branch.push(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return branch.reverse();
  }

  setActiveNode(conversationId: string, nodeId: string | null): void {
    if (nodeId) {
      const node = this.getNode(nodeId);
      if (!node || node.conversationId !== conversationId) throw new Error("节点不属于当前会话");
    }
    this.db.raw.prepare(
      "UPDATE conversations SET active_node_id = ?, updated_at = ? WHERE id = ?",
    ).run(nodeId, now(), conversationId);
  }

  private touchProject(projectId: string, updatedAt: string): void {
    this.db.raw.prepare(
      "UPDATE research_projects SET updated_at = ? WHERE id = ?",
    ).run(updatedAt, projectId);
  }
}
