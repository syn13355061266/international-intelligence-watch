/** A process-wide admission gate: bounded concurrency, spaced starts and shared cooldown. */
export class RequestGate {
  private tail: Promise<void> = Promise.resolve();
  private active = 0;
  private nextAt = 0;
  private wake: (() => void) | undefined;

  private readonly limits: () => { concurrency: number; spacingMs: number };
  constructor(limits: () => { concurrency: number; spacingMs: number }) { this.limits = limits; }

  cooldown(ms: number): void {
    this.nextAt = Math.max(this.nextAt, Date.now() + ms);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let admitted!: () => void;
    this.tail = new Promise<void>(resolve => { admitted = resolve; });
    await previous;
    try {
      const { concurrency, spacingMs } = this.limits();
      while (this.active >= concurrency) await new Promise<void>(resolve => { this.wake = resolve; });
      // Recheck after sleeping: another in-flight call may have extended the shared cooldown.
      while (Date.now() < this.nextAt) await new Promise(resolve => setTimeout(resolve, this.nextAt - Date.now()));
      this.active += 1;
      this.nextAt = Date.now() + spacingMs;
    } finally {
      admitted();
    }
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.wake?.();
      this.wake = undefined;
    }
  }
}
