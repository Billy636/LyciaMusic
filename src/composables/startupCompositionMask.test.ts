import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseStartupCompositionMask } from './startupCompositionMask';
import { waitForStartupRevealReadiness } from './startupCompositionMask';

describe('startup composition mask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('waits for stable paint and keeps the mask visible for the minimum duration', async () => {
    const hide = vi.fn();
    const release = releaseStartupCompositionMask({
      startedAt: 100,
      now: () => 180,
      minVisibleMs: 160,
      maxVisibleMs: 420,
      waitForStablePaint: async () => undefined,
      hide,
    });

    await vi.advanceTimersByTimeAsync(79);
    expect(hide).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await release;

    expect(hide).toHaveBeenCalledOnce();
  });

  it('does not wait once the mask has already exceeded the maximum duration', async () => {
    const hide = vi.fn();
    const release = releaseStartupCompositionMask({
      startedAt: 100,
      now: () => 600,
      minVisibleMs: 160,
      maxVisibleMs: 420,
      waitForStablePaint: async () => undefined,
      hide,
    });

    await vi.advanceTimersByTimeAsync(0);
    await release;

    expect(hide).toHaveBeenCalledOnce();
  });

  it('delays startup reveal until stable paint and the minimum hidden wait have completed', async () => {
    const waitForStablePaint = vi.fn(async () => undefined);
    const readiness = waitForStartupRevealReadiness({
      minDelayMs: 120,
      waitForStablePaint,
    });

    await vi.advanceTimersByTimeAsync(119);
    let settled = false;
    void readiness.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await readiness;

    expect(waitForStablePaint).toHaveBeenCalledOnce();
  });
});
