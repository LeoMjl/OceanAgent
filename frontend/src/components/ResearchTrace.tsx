import {
  ArrowUpRight, Brain, CheckCircle, CircleNotch, Database, Globe, MagnifyingGlass, WarningCircle,
} from "@phosphor-icons/react";
import type { Citation, ToolTrace } from "../api";
import { toolLabel, type ResearchActivity } from "../useOceanAgent";

interface ResearchTraceProps {
  activities?: ResearchActivity[];
  citations?: Citation[];
  traces?: ToolTrace[];
  live?: boolean;
  title?: string;
}

function ActivityIcon({ status }: { status: ResearchActivity["status"] }) {
  if (status === "running") return <CircleNotch className="spin" />;
  if (status === "failed") return <WarningCircle />;
  return <CheckCircle weight="fill" />;
}

export function ResearchTrace({
  activities = [], citations = [], traces = [], live = false, title,
}: ResearchTraceProps) {
  const history: ResearchActivity[] = traces.map((trace) => ({
    id: trace.id,
    toolName: trace.name,
    label: toolLabel(trace.name),
    detail: trace.detail,
    status: trace.status,
    createdAt: trace.startedAt,
  }));
  const steps = live ? activities : history;
  if (!live && citations.length === 0 && steps.length === 0) return null;
  const summary = title ?? (live
    ? `研究过程${activities.length ? ` · ${activities.length} 步` : ""}`
    : `研究过程 · ${steps.length} 步${citations.length ? ` · ${citations.length} 个来源` : ""}`);

  return (
    <details className={`research-trace ${live ? "live-trace" : "persisted-trace"}`} open={live}>
      <summary><MagnifyingGlass /> <span>{summary}</span>{live && <i>进行中</i>}</summary>
      <div className="trace-content">
        {steps.map((activity) => (
          <div className={`trace-step ${activity.status} ${activity.toolName === "report_research_reasoning" ? "reasoning-step" : ""}`} key={activity.id}>
            {activity.toolName === "report_research_reasoning"
              ? <Brain weight="duotone" />
              : <ActivityIcon status={activity.status} />}
            <div><b>{activity.label}</b>{activity.detail && <small>{activity.detail}</small>}</div>
          </div>
        ))}
        {citations.length > 0 && (
          <div className="trace-sources">
            <p>检索来源</p>
            {citations.map((citation, index) => {
              const SourceIcon = citation.sourceType === "ocean_rag" ? Database : Globe;
              const content = (
                <><SourceIcon /><span><small>{index + 1}. {citation.sourceType === "ocean_rag" ? "Ocean-RAG" : "网络资料"}</small><b>{citation.title}</b></span>{citation.url && <ArrowUpRight />}</>
              );
              return citation.url ? (
                <a href={citation.url} target="_blank" rel="noreferrer" key={citation.id}>{content}</a>
              ) : <div className="trace-source" key={citation.id}>{content}</div>;
            })}
          </div>
        )}
        {live && steps.length === 0 && citations.length === 0 && (
          <div className="trace-step running"><CircleNotch className="spin" /><div><b>正在分析研究问题</b></div></div>
        )}
      </div>
    </details>
  );
}
