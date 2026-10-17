import { waitForWindowPaint } from './windowPaint';

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
  waitForStablePaint: waitForPaint = waitForWindowPaint,
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
  waitForStablePaint: waitForPaint = waitForWindowPaint,
}: ReleaseStartupCompositionMaskOptions) {
  const elapsed = Math.max(0, now() - startedAt);
  const remainingMaximum = Math.max(0, maxVisibleMs - elapsed);
  if (remainingMaximum === 0) {
    hide();
    return;
  }

  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await waitForPaint();
        const remainingMinimum = Math.max(0, minVisibleMs - Math.max(0, now() - startedAt));
        if (remainingMinimum > 0) await delay(remainingMinimum);
      })(),
      new Promise<void>(resolve => {
        deadline = setTimeout(resolve, remainingMaximum);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    hide();
  }
}
