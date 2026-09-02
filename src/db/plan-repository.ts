import type { PlanStatus, ResearchPlan } from "../contracts.js";
import { OceanDatabase } from "./database.js";

type Row = Record<string, unknown>;

function mapPlan(row: Row): ResearchPlan {
  const parsed = JSON.parse(String(row.plan_json)) as ResearchPlan;
  return {
    ...parsed,
    id: String(row.id),
    conversationId: String(row.conversation_id),
    nodeId: row.node_id ? String(row.node_id) : undefined,
    version: Number(row.version),
    status: String(row.status) as PlanStatus,
    createdAt: String(row.created_at),
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
  };
}

export class PlanRepository {
  constructor(private readonly db: OceanDatabase) {}

  nextVersion(conversationId: string): number {
    const row = this.db.raw.prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM plans WHERE conversation_id = ?",
    ).get(conversationId) as { version: number };
    return Number(row.version);
  }

  save(plan: ResearchPlan): ResearchPlan {
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO plans
          (id, conversation_id, node_id, version, status, plan_json, created_at, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.id,
        plan.conversationId,
        plan.nodeId ?? null,
        plan.version,
        plan.status,
        JSON.stringify(plan),
        plan.createdAt,
        plan.approvedAt ?? null,
      );
      const insertStep = this.db.raw.prepare(`
        INSERT INTO plan_steps
          (id, plan_id, step_key, position, depends_on_json, status, input_json)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `);
      plan.steps.forEach((step, index) => {
        insertStep.run(
          `${plan.id}:${step.id}`,
          plan.id,
          step.id,
          index,
          JSON.stringify(step.dependsOn),
          JSON.stringify(step.inputs ?? {}),
        );
      });
    });
    return plan;
  }

  get(id: string): ResearchPlan | null {
    const row = this.db.raw.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Row | undefined;
    return row ? mapPlan(row) : null;
  }

  list(conversationId: string): ResearchPlan[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM plans WHERE conversation_id = ? ORDER BY version DESC",
    ).all(conversationId) as Row[];
    return rows.map(mapPlan);
  }

  updateStatus(id: string, status: PlanStatus): ResearchPlan {
    const plan = this.get(id);
    if (!plan) throw new Error("科研规划不存在");
    const approvedAt = status === "approved" ? new Date().toISOString() : plan.approvedAt;
    const next = { ...plan, status, approvedAt };
    this.db.raw.prepare(`
      UPDATE plans SET status = ?, approved_at = ?, plan_json = ? WHERE id = ?
    `).run(status, approvedAt ?? null, JSON.stringify(next), id);
    return this.get(id)!;
  }

  attachNode(id: string, nodeId: string): ResearchPlan {
    const plan = this.get(id);
    if (!plan) throw new Error("科研规划不存在");
    const next = { ...plan, nodeId };
    this.db.raw.prepare(
      "UPDATE plans SET node_id = ?, plan_json = ? WHERE id = ?",
    ).run(nodeId, JSON.stringify(next), id);
    return this.get(id)!;
  }
}
