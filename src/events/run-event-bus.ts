import type { StreamEvent } from "../contracts.js";
import { RunRepository } from "../db/run-repository.js";

type Listener = (event: StreamEvent) => void;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly runs: RunRepository) {}

  publish<T>(runId: string, type: StreamEvent<T>["type"], data: T): StreamEvent<T> {
    const event = this.runs.appendEvent({
      runId,
      type,
      data,
      createdAt: new Date().toISOString(),
    });
    for (const listener of this.listeners.get(runId) ?? []) listener(event);
    return event;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  replay(runId: string, afterId = 0): StreamEvent[] {
    return this.runs.listEvents(runId, afterId);
  }
}
