import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation, ConfiguredModel, ConversationDetail, ModelReference } from "../api";
import type { ResearchActivity } from "../useOceanAgent";
import { activeBranch } from "../tree";
import { ClarificationDock, clarificationAction } from "./ClarificationDock";
import { MessageCard } from "./MessageCard";
import { ResearchTrace } from "./ResearchTrace";

interface ChatPaneProps {
  detail: ConversationDetail | null;
  draftProjectTitle?: string;
  streamingText: string;
  activities: ResearchActivity[];
  liveCitations: Citation[];
  status: string;
  busy: boolean;
  error: string | null;
  models: ConfiguredModel[];
  selectedModel: ModelReference | null;
  onModelChange: (model: ModelReference) => void;
  onSend: (content: string) => void;
  onClarify: (nodeId: string, content: string) => void;
  onAbort: () => void;
}

const SUGGESTIONS = [
  "评估西北太平洋热带气旋路径预报所需的数据与方法",
  "为南海叶绿素浓度反演设计一套可执行的研究方案",
  "检索海表温度异常与海洋热浪研究的常用数据集",
];

export function ChatPane(props: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const canCompose = Boolean(props.detail || props.draftProjectTitle);
  const branch = useMemo(
    () => activeBranch(props.detail?.nodes ?? [], props.detail?.conversation.activeNodeId ?? null),
    [props.detail],
  );
  const answeredClarifications = useMemo(() => {
    const byId = new Map(branch.map((node) => [node.id, node]));
    const answered = new Set<string>();
    for (const node of branch) {
      if (node.metadata.uiHidden === true && typeof node.metadata.clarificationForNodeId === "string") {
        answered.add(String(node.metadata.clarificationForNodeId));
      }
      if (node.role === "user" && node.parentId && byId.get(node.parentId)?.kind === "clarification") {
        answered.add(node.parentId);
      }
    }
    return answered;
  }, [branch]);
  const visibleBranch = useMemo(() => branch.filter((node) => node.metadata.uiHidden !== true), [branch]);
  const pendingClarification = useMemo(() => [...branch].reverse().find((node) => (
    node.kind === "clarification"
    && !answeredClarifications.has(node.id)
    && Boolean(clarificationAction(node))
  )) ?? null, [answeredClarifications, branch]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleBranch.length, props.streamingText, props.activities.length, props.liveCitations.length]);

  const send = (value = draft) => {
    const content = value.trim();
    if (!content || props.busy || !canCompose || pendingClarification) return;
    props.onSend(content);
    setDraft("");
  };

  return (
    <main className="chat-pane">
      <header className="chat-header">
        <div>
          <span className="eyebrow">ACTIVE RESEARCH</span>
          <h1>{props.detail?.conversation.title ?? (props.draftProjectTitle ? `新会话 · ${props.draftProjectTitle}` : "从项目的 ··· 菜单中新建会话")}</h1>
        </div>
        <div className={`run-pill ${props.busy ? "working" : ""}`}>
          <span />{props.status}
        </div>
      </header>

      <section className="message-scroll">
        {visibleBranch.length === 0 ? (
          <div className="welcome-state">
            <div className="welcome-orbit"><span>O</span></div>
            <p className="eyebrow">OCEAN INTELLIGENCE</p>
            <h2>从一个海洋科学问题开始</h2>
            <p>我会判断任务复杂度，按需检索 Ocean-RAG 与联网资料；复杂科研任务会先生成计划，等你确认后再执行。</p>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((item, index) => (
                <button key={item} type="button" disabled={!canCompose} onClick={() => send(item)}>
                  <i>0{index + 1}</i><span>{item}</span><b>↗</b>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-stack">
            {visibleBranch.map((node) => (
              <MessageCard
                key={node.id}
                node={node}
                citations={props.detail?.citations[node.id]}
                traces={props.detail?.traces[node.id]}
              />
            ))}
            {props.busy && (
              <article className="message-row assistant-row streaming-row">
                <div className="avatar ocean-avatar">O</div>
                <div className="assistant-message">
                  <div className="message-author"><b>OceanAgent</b><span className="thinking">正在研究</span></div>
                  <ResearchTrace activities={props.activities} citations={props.liveCitations} live />
                  {props.streamingText ? (
                    <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{props.streamingText}</ReactMarkdown></div>
                  ) : null}
                </div>
              </article>
            )}
          </div>
        )}
        <div ref={endRef} />
      </section>

      <footer className="composer-wrap">
        {props.error && <div className="error-banner">{props.error}</div>}
        {pendingClarification && (
          <ClarificationDock
            key={pendingClarification.id}
            node={pendingClarification}
            onSubmit={props.onClarify}
          />
        )}
        <div className="composer">
          <textarea
            value={draft}
            disabled={props.busy || !canCompose || Boolean(pendingClarification)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={pendingClarification
              ? "请先完成上方的确认需求"
              : canCompose
                ? "描述你的海洋科研问题，可包含时空范围、变量和目标…"
                : "请先从研究项目右侧的 ··· 菜单中新建会话"}
            rows={2}
          />
          <div className="composer-controls">
            <label className="composer-model-select" title="选择本次对话使用的模型">
              <select
                disabled={props.busy || !props.models.length}
                value={props.selectedModel ? `${props.selectedModel.providerId}::${props.selectedModel.modelId}` : ""}
                onChange={(event) => {
                  const model = props.models.find((item) => item.key === event.target.value);
                  if (model) props.onModelChange({ providerId: model.providerId, modelId: model.modelId });
                }}
              >
                {props.models.map((model) => <option key={model.key} value={model.key}>{model.name} · {model.providerName}</option>)}
              </select>
            </label>
            {props.busy ? (
              <button className="stop-button" type="button" onClick={props.onAbort} aria-label="停止运行">■</button>
            ) : (
              <button className="send-button" type="button" disabled={!draft.trim() || !canCompose || Boolean(pendingClarification) || !props.selectedModel} onClick={() => send()} aria-label="发送">↑</button>
            )}
          </div>
        </div>
        <small className="composer-note">OceanAgent 可能犯错，重要科研结论请核验来源。</small>
      </footer>
    </main>
  );
}
