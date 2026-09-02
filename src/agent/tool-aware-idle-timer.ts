export class ToolAwareIdleTimer {
  private timer?: NodeJS.Timeout;
  private readonly activeToolIds = new Set<string>();

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  touch(): void {
    if (this.activeToolIds.size === 0) this.arm();
  }

  toolStarted(toolCallId: string): void {
    this.activeToolIds.add(toolCallId);
    this.clear();
  }

  toolUpdated(toolCallId: string): void {
    this.activeToolIds.add(toolCallId);
    this.clear();
  }

  toolEnded(toolCallId: string): void {
    this.activeToolIds.delete(toolCallId);
    if (this.activeToolIds.size === 0) this.arm();
  }

  dispose(): void {
    this.clear();
    this.activeToolIds.clear();
  }

  private arm(): void {
    this.clear();
    this.timer = setTimeout(this.onTimeout, this.timeoutMs);
  }

  private clear(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
