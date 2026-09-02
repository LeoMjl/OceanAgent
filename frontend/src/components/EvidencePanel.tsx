import { useEffect, useMemo, useRef } from "react";
import { CheckCircle, CircleNotch, Database, ListChecks, WarningCircle } from "@phosphor-icons/react";
import type { ConversationDetail, HealthStatus, ResearchPlan } from "../api";
import type { ResearchActivity } from "../useOceanAgent";
import { shortText } from "../tree";

interface EvidencePanelProps {
  detail: ConversationDetail | null;
  livePlan: ResearchPlan | null;
  activities: ResearchActivity[];
  busy: boolean;
  status: string;
  ragStatus: HealthStatus["rag"] | null;
  onPlanAction: (id: string, action: "approve" | "reject") => void;
}

const STATUS_LABEL: Record<ResearchPlan["status"], string> = {
  awaiting_approval: "规划待确认",
  approved: "执行准备中",
  rejected: "规划已暂停",
  executing: "执行中",
  completed: "已完成",
  failed: "执行失败",
};

function ProgressIcon({ status }: { status: ResearchActivity["status"] }) {
  if (status === "running") return <CircleNotch className="spin" />;
  if (status === "failed") return <WarningCircle weight="fill" />;
  return <CheckCircle weight="fill" />;
}

export function EvidencePanel({ detail, livePlan, activities, busy, status, ragStatus, onPlanAction }: EvidencePanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const plan = useMemo(() => {
    const stored = detail?.plans ?? [];
    const plans = livePlan ? [livePlan, ...stored.filter((item) => item.id !== livePlan.id)] : stored;
    return plans.sort((a, b) => b.version - a.version)[0];
  }, [detail?.plans, livePlan]);
  const executionObserved = !!plan
    && plan.status === "awaiting_approval"
    && busy
    && activities.some((item) => ["bash", "run_remote_command", "edit", "write"].includes(item.toolName ?? ""));
  const planning = !executionObserved && (plan?.status === "awaiting_approval" || plan?.status === "rejected");
  const phase = planning ? "规划阶段" : plan || busy || activities.length ? "执行阶段" : "科研状态";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activities]);

  return (
    <aside className="research-rail">
      <section className="research-assets">
        <header><div><span className="eyebrow">ASSETS</span><h2>科研资产</h2></div><i>{ragStatus ? (ragStatus.credentialConfigured ? "在线" : "待配置") : "连接中"}</i></header>
        <div className="asset-row"><span><Database weight="duotone" /></span><div><b>Ocean-RAG</b><small>{ragStatus?.documents ?? "—"} 条知识卡 · {ragStatus?.credentialConfigured ? (ragStatus.embeddingModel ?? "向量索引") : "请配置阿里云模型"}</small></div></div>
      </section>
      <section className="research-widget">
        <header>
          <div><span className="eyebrow">RESEARCH</span><h2>{phase}</h2></div>
          <i className={busy ? "working" : ""}>{executionObserved ? "执行中" : plan ? STATUS_LABEL[plan.status] : status}</i>
        </header>

        {planning && plan ? (
          <div className="widget-plan">
            <div className="widget-plan-title"><ListChecks /><div><small>PLAN · V{plan.version}</small><b>{plan.objective}</b></div></div>
            <ol>
              {plan.steps.map((step) => (
                <li key={step.id}><span>{step.id}</span><div><b>{step.title}</b><small>{shortText(step.description, 68)}</small></div></li>
              ))}
            </ol>
            {plan.status === "awaiting_approval" && (
              <div className="widget-actions">
                <button type="button" onClick={() => onPlanAction(plan.id, "reject")}>暂不执行</button>
                <button className="primary" type="button" onClick={() => onPlanAction(plan.id, "approve")}>确认并执行</button>
              </div>
            )}
            {plan.status === "rejected" && <p className="widget-note">规划已暂停，你可以在对话中提出修改意见。</p>}
          </div>
        ) : (
          <div className="widget-progress">
            {activities.length ? activities.map((item) => (
              <div className={`widget-progress-item ${item.status}`} key={item.id}>
                <ProgressIcon status={item.status} />
                <div><b>{item.label}</b>{item.detail && <small>{shortText(item.detail, 52)}</small>}</div>
              </div>
            )) : (
              <div className="widget-empty"><ListChecks /><p>{plan ? STATUS_LABEL[plan.status] : "发送问题后，这里会显示规划或执行进度。"}</p></div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </section>
    </aside>
  );
}
