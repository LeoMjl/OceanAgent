export function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (!item || typeof item !== "object") return "";
    const block = item as { type?: unknown; text?: unknown };
    return block.type === "text" && typeof block.text === "string" ? block.text : "";
  }).join("");
}

export function chooseAssistantText(completed: readonly string[], streamed: string): string {
  const authoritative = completed.filter((text) => text.trim()).join("\n\n").trim();
  return authoritative || streamed.trim();
}
