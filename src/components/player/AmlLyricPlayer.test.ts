import { describe, expect, it } from 'vitest';

import source from './AmlLyricPlayer.vue?raw';

describe('AmlLyricPlayer playback pausing', () => {
  it('freezes word animations without switching AMLL into its global paused layout', () => {
    expect(source).toContain('player.setPlaybackPaused(!props.playing);');
    expect(source).not.toContain('player.pause();');
    expect(source).not.toContain('player.resume();');
  });

  it('keeps line gap changes to a single coalesced layout recovery', () => {
    expect(source).toContain('function queueRecovery(reason: string, options: { maxAttempts?: number } = {})');
    expect(source).toContain('queueRecoveryMaxAttempts = Math.max(queueRecoveryMaxAttempts, maxAttempts);');
    expect(source).toContain('queueRecovery(\'line-gap\', { maxAttempts: 0 });');
  });

  it('stops the animation and layout recovery loops while low power rendering is active', () => {
    expect(source).toContain('lowPower?: boolean;');
    expect(source).toContain('if (props.disabled || props.lowPower)');
    expect(source).toContain('pendingLowPowerRecoveryReason = reason;');
    expect(source).toContain('watch(() => props.lowPower');
  });

  it('uses a local playback clock instead of applying every external currentTime tick', () => {
    expect(source).toContain('LOCAL_CLOCK_SYNC_DRIFT_MS');
    expect(source).toContain('function resolveLocalCurrentTime(frameTime: number)');
    expect(source).toContain('syncExternalCurrentTime(false)');
    expect(source).not.toContain('watch(() => props.currentTime, (value) => {\n  player?.setCurrentTime(Math.trunc(value));\n});');
  });
});
