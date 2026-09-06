import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuxWindowLease } from './auxWindowLease';

describe('AuxWindowLease', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires only after the configured idle duration', () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    const lease = new AuxWindowLease(120_000);

    lease.schedule(onExpired);
    vi.advanceTimersByTime(119_999);
    expect(onExpired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('renews and cancels a pending expiration', () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    const lease = new AuxWindowLease(120_000);

    lease.schedule(onExpired);
    vi.advanceTimersByTime(90_000);
    lease.schedule(onExpired);
    vi.advanceTimersByTime(90_000);
    expect(onExpired).not.toHaveBeenCalled();

    lease.cancel();
    vi.advanceTimersByTime(120_000);
    expect(onExpired).not.toHaveBeenCalled();
  });
});
