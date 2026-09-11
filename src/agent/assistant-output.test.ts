import { describe, expect, it } from "vitest";
import { chooseAssistantText, extractAssistantText } from "./assistant-output.js";

describe("assistant output", () => {
  it("extracts text blocks while ignoring thinking and tool calls", () => {
    expect(extractAssistantText([
      { type: "thinking", thinking: "internal" },
      { type: "text", text: "你好" },
      { type: "toolCall", name: "search" },
      { type: "text", text: "，欢迎。" },
    ])).toBe("你好，欢迎。");
  });

  it("uses the authoritative completed messages before streamed deltas", () => {
    expect(chooseAssistantText(["第一段", "第二段"], "partial")).toBe("第一段\n\n第二段");
  });

  it("falls back to streamed text when no completed message is available", () => {
    expect(chooseAssistantText([], "  流式回答  ")).toBe("流式回答");
  });
});
