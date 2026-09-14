import type { RunActivity } from "../../../src/run-timeline";

export function splitExecution(activities: RunActivity[], content: string) {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const texts = activities.filter((item) => item.kind === "text");
  const lastText = texts.at(-1);
  const lastTool = activities.filter((item) => item.kind === "tool").at(-1);
  const lastToolIndex = lastTool ? activities.indexOf(lastTool) : -1;
  const lastTextIndex = lastText ? activities.indexOf(lastText) : -1;
  const matches = normalize(texts.map((item) => item.text).join("\n\n")) === normalize(content)
    || normalize(lastText?.text ?? "") === normalize(content);
  if (lastText && lastTextIndex > lastToolIndex && matches) {
    return { process: activities.filter((item) => item.id !== lastText.id), answer: lastText.text ?? content };
  }
  return { process: activities, answer: content };
}

export function durationLabel(milliseconds?: number) {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return "执行过程";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `用时 ${minutes ? `${minutes}分 ` : ""}${seconds % 60}秒`;
}
