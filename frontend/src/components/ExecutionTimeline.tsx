import { CaretRight, CircleNotch, TerminalWindow, WarningCircle, Brain, Robot } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RunActivity } from "../../../src/run-timeline";
import { toolLabel } from "../useOceanAgent";
import type { SubagentResult } from "../../../src/agent/subagent-session";
import { splitExecution } from "./execution-summary";
import { subagentsForActivity } from "./subagent-activity";

function SubagentExecution({ item }: { item: RunActivity }) {
  const children = subagentsForActivity(item);
  return <div className="subagent-batch">
    <div className="subagent-batch-heading"><Robot /><span>科研子智能体协作 · 已创建 {children.length} 个子智能体{item.status === "running" ? "，正在协作" : " · 协作已结束"}</span></div>
    {children.map((child, index) => {
      const split = splitExecution(child.activities, child.output);
      return <details className="subagent-execution subagent-visible" key={child.id}>
        <summary>
          <Robot className={`subagent-avatar subagent-color-${index % 3}`} weight="duotone" />
          <span className="subagent-name">{child.name}</span>
          <span className={`subagent-state ${child.status}`}>
            {child.status === "running" && <CircleNotch className="spin" />}
            {child.status === "running" ? "正在工作" : child.status === "failed" ? "未完成" : "已完成"}
          </span>
          <CaretRight className="disclosure-caret" />
        </summary>
        <div className="subagent-detail"><p>{child.task}</p>
          <ExecutionTimeline activities={split.process} />
          {split.answer && <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{split.answer}</ReactMarkdown></div>}
        </div>
      </details>;
    })}
    {!children.length && <ToolExecution item={item} />}
  </div>;
}

const isCommand = (item: RunActivity) => item.toolName === "bash" || item.toolName === "run_remote_command";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object"
  ? value as Record<string, unknown> : {};
const pretty = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";

function ToolExecution({ item }: { item: RunActivity }) {
  const args = record(item.args);
  const result = record(item.result);
  const subagents = Array.isArray(record(result.details).subagents)
    ? record(result.details).subagents as SubagentResult[] : [];
  const command = typeof args.command === "string" ? args.command : undefined;
  const output = Array.isArray(result.content)
    ? result.content.filter((block) => record(block).type === "text").map((block) => String(record(block).text ?? "")).join("\n")
    : pretty(item.result);
  const status = item.status === "running" ? "正在执行" : item.status === "failed" ? "执行失败" : "已运行";
  const elapsed = item.finishedAt ? (Date.parse(item.finishedAt) - Date.parse(item.createdAt)) / 1000 : undefined;
  return (
    <details className={`tool-execution ${item.status}`}>
      <summary>
        {item.status === "running" ? <CircleNotch className="spin" /> : item.status === "failed" ? <WarningCircle /> : <TerminalWindow />}
        <span className="tool-preview">{status} {command ?? item.detail ?? toolLabel(item.toolName ?? "工具")}{subagents.length > 0 ? ` · ${subagents.length} 个子任务` : ""}</span>
        <CaretRight className="disclosure-caret" />
      </summary>
      <div className="tool-execution-body">
        <div className="tool-execution-meta">
          <span>{item.toolName === "run_remote_command" ? "远程命令" : item.toolName === "bash" ? "本地命令" : toolLabel(item.toolName ?? "工具")}</span>
          <span>{status}{elapsed !== undefined && Number.isFinite(elapsed) ? ` · ${Math.max(0, elapsed).toFixed(1)} 秒` : ""}</span>
        </div>
        <p>{command ? "执行的命令" : "调用参数"}</p>
        <pre><code>{command ?? (item.args == null ? "此记录未保存参数" : pretty(item.args))}</code></pre>
        {command && Object.keys(args).some((key) => key !== "command") && (
          <details className="tool-extra"><summary>其他参数</summary><pre>{pretty(Object.fromEntries(Object.entries(args).filter(([key]) => key !== "command")))}</pre></details>
        )}
        <p>{item.status === "running" ? "实时输出" : "执行结果"}</p>
        <pre className="tool-output"><code>{output || (item.status === "running" ? "等待工具输出…" : item.result == null ? "此记录未保存结果" : "工具未返回文本输出")}</code></pre>
        {subagents.map((child) => {
          const split = splitExecution(child.activities, child.output);
          return <details className="subagent-execution" key={child.id}>
            <summary><span>{child.name} · {child.status === "running" ? "执行中" : child.status === "failed" ? "失败" : "已完成"}</span><CaretRight className="disclosure-caret" /></summary>
            <p>{child.task}</p>
            <ExecutionTimeline activities={split.process} />
            {child.output && <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{split.answer}</ReactMarkdown></div>}
          </details>;
        })}
        {result.details != null && !subagents.length && (
          <details className="tool-extra"><summary>结果详情</summary><pre>{pretty(result.details)}</pre></details>
        )}
      </div>
    </details>
  );
}

export function ExecutionTimeline({ activities }: { activities: RunActivity[] }) {
  const groups: RunActivity[][] = [];
  for (const item of activities) {
    const last = groups.at(-1);
    if (isCommand(item) && last && isCommand(last[0])) last.push(item);
    else groups.push([item]);
  }
  return <div className="execution-timeline">{groups.map((group) => {
    const item = group[0];
    if (item.kind === "progress") return <div className="execution-status" key={item.id}><Brain /><span>{item.text}</span></div>;
    if (item.kind === "text") return (
      <div className="markdown-body activity-commentary" key={item.id}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text ?? ""}</ReactMarkdown>
      </div>
    );
    if (item.toolName === "report_research_reasoning") {
      const args = record(item.args);
      const summary = [args.summary, args.decision, args.uncertainty].filter((value) => typeof value === "string" && value.trim()).join("\n\n");
      return <div className="markdown-body activity-commentary" key={item.id}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary || item.detail || "正在整理研究依据…"}</ReactMarkdown>
      </div>;
    }
    if (item.toolName === "subagent") return <SubagentExecution item={item} key={item.id} />;
    if (!isCommand(item)) return <ToolExecution item={item} key={item.id} />;
    const running = group.some((entry) => entry.status === "running");
    const failed = group.some((entry) => entry.status === "failed");
    return <details className={`command-group ${failed ? "failed" : ""}`} key={item.id}>
      <summary>
        {running ? <CircleNotch className="spin" /> : <TerminalWindow />}
        <span>{running ? "正在运行命令" : "运行了命令"}</span>
        {group.length > 1 && <span className="command-count">{group.length}</span>}
        {failed && <span className="command-failure">含失败记录</span>}
        <CaretRight className="disclosure-caret" />
      </summary>
      <div className="command-list">{group.map((entry) => <ToolExecution item={entry} key={entry.id} />)}</div>
    </details>;
  })}</div>;
}
