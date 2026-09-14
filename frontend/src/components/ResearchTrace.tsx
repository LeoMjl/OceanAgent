import {
  ArrowUpRight, CaretRight, CircleNotch, Database, Globe,
} from "@phosphor-icons/react";
import type { Citation, ToolTrace } from "../api";
import { type ResearchActivity } from "../useOceanAgent";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { useEffect, useState } from "react";
import { durationLabel } from "./execution-summary";

interface ResearchTraceProps {
  activities?: ResearchActivity[];
  citations?: Citation[];
  traces?: ToolTrace[];
  live?: boolean;
  title?: string;
  durationMs?: number;
}

export function ResearchTrace({
  activities = [], citations = [], traces = [], live = false, title, durationMs,
}: ResearchTraceProps) {
  const [open, setOpen] = useState(live);
  useEffect(() => setOpen(live), [live]);
  const history: ResearchActivity[] = traces.map((trace) => ({
    id: trace.id,
    kind: "tool",
    toolName: trace.name,
    detail: trace.detail,
    args: trace.args,
    result: trace.result,
    status: trace.status,
    createdAt: trace.startedAt,
    finishedAt: trace.finishedAt,
  }));
  const steps = live || activities.length ? activities : history;
  if (!live && citations.length === 0 && steps.length === 0) return null;
  return (
    <details className="research-execution" aria-label={title ?? "研究过程"} open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="execution-summary">
          <span>{live ? "执行中" : durationLabel(durationMs)}</span><CaretRight className="disclosure-caret" />
        </summary>
        <ExecutionTimeline activities={steps} />
        {citations.length > 0 && (
          <details className="trace-sources">
            <summary>检索来源 · {citations.length}</summary>
            {citations.map((citation, index) => {
              const SourceIcon = citation.sourceType === "ocean_rag" ? Database : Globe;
              const content = (
                <><SourceIcon /><span><small>{index + 1}. {citation.sourceType === "ocean_rag" ? "Ocean-RAG" : "网络资料"}</small><b>{citation.title}</b></span>{citation.url && <ArrowUpRight />}</>
              );
              return citation.url ? (
                <a href={citation.url} target="_blank" rel="noreferrer" key={citation.id}>{content}</a>
              ) : <div className="trace-source" key={citation.id}>{content}</div>;
            })}
          </details>
        )}
        {live && steps.length === 0 && citations.length === 0 && (
          <div className="trace-step running"><CircleNotch className="spin" /><div><b>正在分析研究问题</b></div></div>
        )}
    </details>
  );
}
