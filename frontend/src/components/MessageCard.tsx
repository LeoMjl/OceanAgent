import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation, ConversationNode, ToolTrace } from "../api";
import { ResearchTrace } from "./ResearchTrace";

interface MessageCardProps {
  node: ConversationNode;
  citations?: Citation[];
  traces?: ToolTrace[];
}

export function MessageCard({ node, citations = [], traces = [] }: MessageCardProps) {
  const isClarification = node.kind === "clarification";

  if (node.role === "user") {
    return (
      <article className="message-row user-row">
        <div className="user-message">{node.content}</div>
        <div className="avatar user-avatar">U</div>
      </article>
    );
  }

  return (
    <article className="message-row assistant-row">
      <div className="avatar ocean-avatar">O</div>
      <div className="assistant-message">
        <div className="message-author"><b>OceanAgent</b><span>科研助手</span></div>
        <ResearchTrace
          citations={citations} traces={traces}
          title={isClarification ? "研究过程 · 确认需求" : undefined}
        />
        {!isClarification && (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </article>
  );
}
