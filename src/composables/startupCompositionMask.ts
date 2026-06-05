const waitForStablePaint = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(resolve, 16);
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  });
});

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, Math.max(0, ms));
});

export interface ReleaseStartupCompositionMaskOptions {
  startedAt: number;
  hide: () => void;
  now?: () => number;
  minVisibleMs?: number;
  maxVisibleMs?: number;
  waitForStablePaint?: () => Promise<unknown>;
}

export interface StartupRevealReadinessOptions {
  minDelayMs?: number;
  waitForStablePaint?: () => Promise<unknown>;
}

export async function waitForStartupRevealReadiness({
  minDelayMs = 120,
  waitForStablePaint: waitForPaint = waitForStablePaint,
}: StartupRevealReadinessOptions = {}) {
  await waitForPaint();
  await delay(minDelayMs);
}

export async function releaseStartupCompositionMask({
  startedAt,
  hide,
  now = () => performance.now(),
  minVisibleMs = 160,
  maxVisibleMs = 420,
  waitForStablePaint: waitForPaint = waitForStablePaint,
}: ReleaseStartupCompositionMaskOptions) {
  await waitForPaint();

  const elapsed = Math.max(0, now() - startedAt);
  const remainingMinimum = Math.max(0, minVisibleMs - elapsed);
  const remainingMaximum = Math.max(0, maxVisibleMs - elapsed);
  const waitMs = Math.min(remainingMinimum, remainingMaximum);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  hide();
}
