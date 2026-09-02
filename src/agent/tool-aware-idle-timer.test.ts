import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolAwareIdleTimer } from "./tool-aware-idle-timer.js";

describe("ToolAwareIdleTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("does not abort while a long-running tool is active", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new ToolAwareIdleTimer(60_000, onTimeout);

    timer.touch();
    timer.toolStarted("tool-1");
    vi.advanceTimersByTime(10 * 60_000);

    expect(onTimeout).not.toHaveBeenCalled();
    timer.toolEnded("tool-1");
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("waits for every parallel tool before restarting the idle timer", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new ToolAwareIdleTimer(1_000, onTimeout);

    timer.toolStarted("tool-1");
    timer.toolStarted("tool-2");
    timer.toolEnded("tool-1");
    vi.advanceTimersByTime(2_000);
    expect(onTimeout).not.toHaveBeenCalled();

    timer.toolEnded("tool-2");
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
