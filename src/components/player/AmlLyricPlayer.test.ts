import { describe, expect, it, vi } from 'vitest';
import type { LyricLine } from '@applemusic-like-lyrics/core';

import { AmlLyricPlayerRuntime, type AmlAnimationScheduler } from './amlLyricPlayerRuntime';

function createFixture(state: ConstructorParameters<typeof AmlLyricPlayerRuntime>[1] = {}) {
  let time = 0;
  let nextId = 0;
  const frames = new Map<number, (time: number) => void>();
  const scheduler: AmlAnimationScheduler = {
    now: () => time,
    requestFrame: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => { frames.delete(id); },
  };
  const player = {
    setLyricLines: vi.fn(),
    setCurrentTime: vi.fn(),
    resetScroll: vi.fn(),
    rebuildLyricView: vi.fn(),
    onResize: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  };
  const runtime = new AmlLyricPlayerRuntime(player, state, scheduler);
  const advance = (elapsed: number) => {
    time += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  };
  const clearCalls = () => Object.values(player).forEach((method) => method.mockClear());
  return { runtime, player, advance, clearCalls, frames };
}

describe('official AMLL playback runtime', () => {
  it('advances a smooth clock without seeking or resetting scroll on ordinary ticks', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 1000 });
    runtime.start();
    clearCalls();

    advance(16);
    runtime.syncCurrentTime(1000);
    advance(16);

    expect(player.setCurrentTime.mock.calls).toEqual([[1016, false], [1032, false]]);
    expect(player.resetScroll).not.toHaveBeenCalled();
    expect(player.update.mock.calls).toEqual([[0], [16]]);
  });

  it('corrects large drift without treating an ordinary sample as an explicit seek', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 1000 });
    runtime.start();
    clearCalls();

    runtime.syncCurrentTime(4000);
    advance(20);

    expect(player.setCurrentTime.mock.calls).toEqual([[4000, false], [4020, false]]);
    expect(player.resetScroll).not.toHaveBeenCalled();
  });

  it('uses official pause/resume and freezes the word clock while paused', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 1000 });
    runtime.start();
    runtime.setPlaying(false, 1050);
    expect(player.pause).toHaveBeenCalledOnce();
    clearCalls();

    advance(500);
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    expect(player.update).toHaveBeenCalledOnce();

    runtime.setPlaying(true, 1050);
    expect(player.resume).toHaveBeenCalledOnce();
    advance(100);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(1150, false);
  });

  it('forces even a small backwards seek and reanchors subsequent animation frames', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 1000 });
    runtime.start();
    advance(100);
    clearCalls();

    runtime.seek(1050.9);
    expect(player.resetScroll).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(1050, true);
    expect(player.update).toHaveBeenCalledWith(0);

    advance(20);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(1070, false);
  });

  it('forces small clock calibrations without requesting a seek or a scroll reset', () => {
    const { runtime, player, clearCalls } = createFixture({ currentTime: 1000 });
    runtime.start();
    clearCalls();

    runtime.syncCurrentTime(1100, true);
    expect(player.setCurrentTime).toHaveBeenCalledWith(1100, false);
    expect(player.resetScroll).not.toHaveBeenCalled();
  });

  it.each([1000, 250])('waits through a positive %sms audio delay, including a sub-drift delay', (delay) => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: -delay });
    runtime.setLyricLines([], -delay);
    runtime.start();
    expect(player.setLyricLines).toHaveBeenCalledWith([], 0);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).not.toHaveBeenCalled();
    clearCalls();

    advance(delay - 1);
    runtime.syncCurrentTime(-1);
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    expect(player.resume).not.toHaveBeenCalled();

    advance(1);
    expect(player.resume).toHaveBeenCalledOnce();
    advance(16);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(16, false);
  });

  it('honours an offset calibration into pre-roll without advancing upstream word animations', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 200 });
    runtime.start();
    clearCalls();

    runtime.syncCurrentTime(-100, true);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(0, false);
    expect(player.resetScroll).not.toHaveBeenCalled();
    advance(99);
    expect(player.resume).not.toHaveBeenCalled();
    advance(1);
    expect(player.resume).toHaveBeenCalledOnce();
    advance(10);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(10, false);
  });

  it('seeks back to a signed pre-roll and resumes only after the remaining delay', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: 5000 });
    runtime.start();
    clearCalls();

    runtime.seek(-250);
    expect(player.resetScroll).toHaveBeenCalledOnce();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(0, true);
    advance(100);
    runtime.syncCurrentTime(-150);
    expect(player.resume).not.toHaveBeenCalled();
    advance(150);
    expect(player.resume).toHaveBeenCalledOnce();
    advance(10);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(10, false);
  });

  it('does not consume a signed pre-roll while audio is paused', () => {
    const { runtime, player, advance, clearCalls } = createFixture({ currentTime: -250, playing: false });
    runtime.start();
    runtime.seek(-200);
    clearCalls();

    advance(1000);
    expect(player.resume).not.toHaveBeenCalled();
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    runtime.setPlaying(true, -200);
    advance(199);
    expect(player.resume).not.toHaveBeenCalled();
    advance(1);
    expect(player.resume).toHaveBeenCalledOnce();
  });

  it('never passes negative or nonfinite times to any official player entry point', () => {
    const { runtime, player, advance } = createFixture({ currentTime: -1000 });
    runtime.setLyricLines([], -1000);
    runtime.start();
    runtime.refreshLayout();
    runtime.seek(-500);
    runtime.syncCurrentTime(Number.NaN, true);
    runtime.seek(Number.NEGATIVE_INFINITY);
    advance(16);

    const submittedTimes = [
      ...player.setLyricLines.mock.calls.map((call) => call[1]),
      ...player.rebuildLyricView.mock.calls.map((call) => call[0]),
      ...player.setCurrentTime.mock.calls.map((call) => call[0]),
    ];
    expect(submittedTimes.length).toBeGreaterThan(0);
    expect(submittedTimes.every((time) => Number.isFinite(time) && time >= 0)).toBe(true);
  });

  it('coalesces time, lyrics and font updates while low power is active', () => {
    const { runtime, player, advance, clearCalls, frames } = createFixture({ currentTime: 1000 });
    runtime.start();
    runtime.setRenderingState({ lowPower: true, disabled: false }, 1000);
    expect(frames.size).toBe(0);
    expect(player.pause).toHaveBeenCalledOnce();
    clearCalls();

    const firstLines: LyricLine[] = [];
    const finalLines: LyricLine[] = [];
    runtime.setLyricLines(firstLines, 2000);
    runtime.refreshLayout();
    runtime.refreshMeasurements();
    runtime.setLyricLines(finalLines, 3000);
    runtime.syncCurrentTime(3500);
    runtime.seek(4000);
    runtime.setPlaying(false, 4000);
    advance(500);
    expect(Object.values(player).every((method) => method.mock.calls.length === 0)).toBe(true);

    runtime.setRenderingState({ lowPower: false, disabled: false }, 4000);
    expect(player.setLyricLines).toHaveBeenCalledExactlyOnceWith(finalLines, 4000);
    expect(player.rebuildLyricView).not.toHaveBeenCalled();
    expect(player.setCurrentTime).toHaveBeenCalledWith(4000, true);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
  });

  it('defers initial work when disabled and resumes exactly one animation loop', () => {
    const { runtime, player, frames } = createFixture({ currentTime: 1000, disabled: true });
    const lines: LyricLine[] = [];
    runtime.setLyricLines(lines);
    runtime.start();
    runtime.start();
    expect(player.setLyricLines).not.toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);

    runtime.setRenderingState({ disabled: false, lowPower: false }, 3000);
    runtime.setRenderingState({ disabled: false, lowPower: false }, 3000);
    expect(player.setLyricLines).toHaveBeenCalledExactlyOnceWith(lines, 3000);
    expect(frames.size).toBe(1);
  });

  it('resumes a playing clock from the latest hidden sample without an explicit seek', () => {
    const { runtime, player, advance, clearCalls, frames } = createFixture({ currentTime: 1000 });
    runtime.start();
    runtime.setRenderingState({ lowPower: true, disabled: false }, 1000);
    clearCalls();
    advance(4000);
    runtime.syncCurrentTime(5000);
    expect(player.setCurrentTime).not.toHaveBeenCalled();

    runtime.setRenderingState({ lowPower: false, disabled: false }, 5000);
    expect(player.resume).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).toHaveBeenCalledWith(5000, false);
    expect(player.resetScroll).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    advance(16);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(5016, false);
  });

  it('rebuilds the complete view through the public font API at the current paused time', () => {
    const { runtime, player, clearCalls } = createFixture({ currentTime: 1200, playing: false });
    runtime.start();
    clearCalls();

    runtime.refreshLayout();
    expect(player.rebuildLyricView).toHaveBeenCalledExactlyOnceWith(1200);
    expect(player.onResize).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resetScroll).not.toHaveBeenCalled();
  });

  it('uses a full reconstruction rather than partially rebuilding offscreen font masks', () => {
    const { runtime, player, clearCalls } = createFixture({ currentTime: 1200, playing: false });
    runtime.start();
    clearCalls();
    let hasMask = false;
    const visibleMasks: boolean[] = [];
    player.rebuildLyricView.mockImplementation(() => { hasMask = true; });
    player.update.mockImplementation(() => { visibleMasks.push(hasMask); });

    runtime.refreshLayout();

    expect(visibleMasks).toEqual([true]);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).not.toHaveBeenCalled();
    expect(player.resetScroll).not.toHaveBeenCalled();
  });

  it('refreshes fixed-container font metrics without rebuilding lines or seeking', () => {
    const { runtime, player, clearCalls } = createFixture({ currentTime: 1200, playing: false });
    runtime.start();
    clearCalls();

    runtime.refreshMeasurements();

    expect(player.onResize).toHaveBeenCalledOnce();
    expect(player.rebuildLyricView).not.toHaveBeenCalled();
    expect(player.resetScroll).not.toHaveBeenCalled();
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    expect(player.update).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('coalesces hidden font-size measurements into one refresh on resume', () => {
    const { runtime, player, clearCalls } = createFixture({ lowPower: true });
    runtime.start();
    clearCalls();

    runtime.refreshMeasurements();
    runtime.refreshMeasurements();
    expect(player.onResize).not.toHaveBeenCalled();

    runtime.setRenderingState({ lowPower: false, disabled: false }, 2000);
    expect(player.onResize).toHaveBeenCalledOnce();
    expect(player.rebuildLyricView).not.toHaveBeenCalled();
  });

  it('coalesces hidden font-family changes into one complete view rebuild', () => {
    const { runtime, player, clearCalls } = createFixture({ currentTime: -1000, lowPower: true });
    runtime.start();
    clearCalls();
    runtime.refreshLayout();
    runtime.refreshLayout();
    runtime.refreshMeasurements();
    expect(player.rebuildLyricView).not.toHaveBeenCalled();

    runtime.setRenderingState({ lowPower: false, disabled: false }, -1000);
    expect(player.onResize).toHaveBeenCalledOnce();
    expect(player.rebuildLyricView).toHaveBeenCalledExactlyOnceWith(0);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).not.toHaveBeenCalled();
  });

  it('applies the paused state to replacement lyric animations', () => {
    const { runtime, player, clearCalls } = createFixture({ playing: false });
    runtime.start();
    clearCalls();

    const lines: LyricLine[] = [];
    runtime.setLyricLines(lines, 9000);
    expect(player.setLyricLines).toHaveBeenCalledExactlyOnceWith(lines, 9000);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).not.toHaveBeenCalled();
  });

  it('cancels frames, disposes once, and ignores all work after unmount', () => {
    const { runtime, player, advance, clearCalls, frames } = createFixture();
    runtime.start();
    expect(frames.size).toBe(1);
    clearCalls();

    runtime.dispose();
    runtime.dispose();
    runtime.start();
    runtime.seek(5000);
    runtime.setLyricLines([]);
    runtime.refreshLayout();
    runtime.refreshMeasurements();
    runtime.setPlaying(false);
    runtime.setRenderingState({ lowPower: false, disabled: false });
    advance(1000);

    expect(frames.size).toBe(0);
    expect(player.dispose).toHaveBeenCalledOnce();
    expect(player.setCurrentTime).not.toHaveBeenCalled();
    expect(player.setLyricLines).not.toHaveBeenCalled();
    expect(player.update).not.toHaveBeenCalled();
  });
});
