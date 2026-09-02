import type { ConversationNode } from "../contracts.js";

const MAX_HISTORY_CHARS = 60_000;
const MAX_NODE_CHARS = 6_000;

export function formatHistory(nodes: ConversationNode[]): string {
  if (nodes.length === 0) return "";
  const recent = nodes.slice(-50);
  const lines = recent.map((node) => {
    const label = node.role === "user" ? "用户" : node.role === "assistant" ? "OceanAgent" : node.role;
    return `[${label}/${node.kind}]\n${node.content.slice(0, MAX_NODE_CHARS)}`;
  });
  const text = lines.join("\n\n");
  return text.length <= MAX_HISTORY_CHARS ? text : text.slice(text.length - MAX_HISTORY_CHARS);
}
