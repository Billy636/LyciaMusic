export class AuxWindowLease {
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(private readonly durationMs: number) {}

  schedule(onExpired: () => void) {
    this.cancel();
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      onExpired();
    }, this.durationMs);
  }

  cancel() {
    if (this.timer === null) return;

    globalThis.clearTimeout(this.timer);
    this.timer = null;
  }
}
