import { describe, expect, it, vi } from "vitest";
import { runSubagentSession, type SubagentResult, type SubagentSessionOptions } from "./subagent-session.js";

const result = (): SubagentResult => ({ id: "child", name: "核验", task: "核验数据源", status: "running", output: "", activities: [] });
function setup(prompt: (emit: (event: unknown) => void) => Promise<void>) {
  let listener = (_event: unknown) => {};
  const session = {
    subscribe: vi.fn((fn: typeof listener) => { listener = fn; return vi.fn(); }),
    prompt: vi.fn(() => prompt(listener)), abort: vi.fn(async () => {}), dispose: vi.fn(),
  };
  const createSession = vi.fn(async () => ({ session }));
  const options = { factory: { createSession }, tools: () => [], toolNames: ["read"], cwd: process.cwd(), model: "test", projectContext: "项目背景", timeoutMs: 1000 } as unknown as SubagentSessionOptions;
  return { session, options, createSession };
}

describe("Pi child session lifecycle", () => {
  it("collects public text and command traces and disposes the independent session", async () => {
    const fake = setup(async (emit) => {
      emit({ type: "tool_execution_start", toolCallId: "t", toolName: "read", args: { path: "data.txt" } });
      emit({ type: "tool_execution_end", toolCallId: "t", result: { content: [{ type: "text", text: "data" }] }, isError: false });
      emit({ type: "message_start", message: { role: "assistant" } });
      emit({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "数据已核验" }] } });
    });
    const child = result();
    await runSubagentSession(fake.options, child, new AbortController().signal, () => {});
    expect(child.status).toBe("completed");
    expect(child.output).toBe("数据已核验");
    expect(child.activities[0]).toMatchObject({ toolName: "read", status: "completed" });
    expect(JSON.stringify(child)).not.toContain("private");
    expect(fake.session.dispose).toHaveBeenCalledOnce();
    expect(fake.createSession.mock.calls[0]).toBeDefined();
  });

  it("propagates cancellation and reports failure instead of a successful partial result", async () => {
    let finish!: () => void;
    const fake = setup(async () => new Promise<void>((resolve) => { finish = resolve; }));
    fake.session.abort.mockImplementation(async () => { finish(); });
    const controller = new AbortController();
    const child = result();
    const running = runSubagentSession(fake.options, child, controller.signal, () => {});
    await vi.waitFor(() => expect(fake.session.prompt).toHaveBeenCalled());
    controller.abort();
    await running;
    expect(fake.session.abort).toHaveBeenCalledOnce();
    expect(fake.session.dispose).toHaveBeenCalledOnce();
    expect(child.status).toBe("failed");
    expect(child.output).toContain("停止");
  });

  it("aborts an over-time child and disposes its session", async () => {
    let finish!: () => void;
    const fake = setup(async () => new Promise<void>((resolve) => { finish = resolve; }));
    fake.options.timeoutMs = 50;
    fake.session.abort.mockImplementation(async () => { finish(); });
    const child = result();
    await runSubagentSession(fake.options, child, new AbortController().signal, () => {});
    expect(child.status).toBe("failed");
    expect(child.output).toContain("超时");
    expect(fake.session.dispose).toHaveBeenCalledOnce();
  });
});
