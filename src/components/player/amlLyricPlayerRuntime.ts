import type { LyricLine } from '@applemusic-like-lyrics/core';

import { normalizeAmlTime, syncAmlLyricSeekLayout } from './amllSeekLayout';

/** Only public APIs: layout, lyric groups and animation internals stay in AMLL. */
export interface AmlLyricPlayerPort {
  setLyricLines: (lines: LyricLine[], initialTime?: number) => void;
  setCurrentTime: (timeMs: number, isSeek?: boolean) => void;
  resetScroll: () => void;
  rebuildLyricView: (initialTime?: number) => void;
  // DomLyricPlayer exposes this override publicly (the base hook is protected).
  onResize: () => void;
  update: (deltaMs?: number) => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
}

export interface AmlAnimationScheduler {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (frameId: number) => void;
}

interface AmlPlaybackState {
  currentTime?: number;
  playing?: boolean;
  disabled?: boolean;
  lowPower?: boolean;
}

const browserScheduler: AmlAnimationScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
};

export const AML_CLOCK_SYNC_DRIFT_MS = 350;

function normalizeClockTime(timeMs: number) {
  return Number.isFinite(timeMs) ? Math.trunc(timeMs) : 0;
}

/** Smooth local playback clock with explicit, separate seek and calibration paths. */
export class AmlLyricPlayerRuntime {
  private started = false;
  private disposed = false;
  private playing: boolean;
  private disabled: boolean;
  private lowPower: boolean;
  private anchorTime: number;
  private anchorFrameTime: number;
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;
  private lastAppliedTime: number | null = null;
  private pendingLines: LyricLine[] | null = null;
  private pendingRebuild = false;
  private pendingMeasurements = true;
  private pendingSeek = false;
  private pendingTimeSync = true;
  private pendingPlaybackState = true;
  private appliedPlaybackState: boolean | null = null;

  constructor(
    private readonly player: AmlLyricPlayerPort,
    state: AmlPlaybackState = {},
    private readonly scheduler: AmlAnimationScheduler = browserScheduler,
  ) {
    this.playing = state.playing ?? true;
    this.disabled = state.disabled ?? false;
    this.lowPower = state.lowPower ?? false;
    this.anchorTime = normalizeClockTime(state.currentTime ?? 0);
    this.anchorFrameTime = scheduler.now();
  }

  private get canRender() {
    return this.started && !this.disposed && !this.disabled && !this.lowPower;
  }

  private currentTime(frameTime = this.scheduler.now()) {
    return normalizeClockTime(this.anchorTime + (
      this.playing ? Math.max(0, frameTime - this.anchorFrameTime) : 0
    ));
  }

  private reanchor(timeMs: number) {
    this.anchorTime = normalizeClockTime(timeMs);
    this.anchorFrameTime = this.scheduler.now();
  }

  private applyCurrentTime(timeMs: number, force = false) {
    const playerTime = normalizeAmlTime(timeMs);
    if (!force && playerTime === this.lastAppliedTime) return;
    this.player.setCurrentTime(playerTime, false);
    this.lastAppliedTime = playerTime;
  }

  private syncPlaybackState(sourceTime: number) {
    // Positive audio delay creates a signed pre-roll. The local clock must run,
    // but upstream Web Animations must remain paused at 0 until that delay ends.
    const playing = this.playing && sourceTime >= 0;
    if (!this.pendingPlaybackState && playing === this.appliedPlaybackState) return;
    if (playing) this.player.resume();
    else this.player.pause();
    this.appliedPlaybackState = playing;
    this.pendingPlaybackState = false;
  }

  private flushPending() {
    if (!this.canRender) return;

    const sourceTime = this.currentTime();
    const timeMs = normalizeAmlTime(sourceTime);
    const replacingLines = this.pendingLines !== null;
    const rebuildingLines = this.pendingRebuild;
    const refreshingLayout = replacingLines || rebuildingLines || this.pendingMeasurements;
    if (this.pendingMeasurements) {
      // A CSS font-size change need not resize the fixed-size player element,
      // so its own root ResizeObserver may not update the cached font metrics.
      this.player.onResize();
      this.pendingMeasurements = false;
    }
    if (this.pendingLines !== null) {
      this.player.setLyricLines(this.pendingLines, timeMs);
      this.lastAppliedTime = timeMs;
      this.pendingLines = null;
      this.pendingPlaybackState = true;
    } else if (this.pendingRebuild) {
      // Full public reconstruction also resets offscreen rows and word-mask
      // measurements. Partial rebuildLyricLines can leave detached rows with
      // zero-width masks when their outer size is unchanged on reattachment.
      this.player.rebuildLyricView(timeMs);
      this.lastAppliedTime = timeMs;
      this.pendingPlaybackState = true;
    }
    this.pendingRebuild = false;

    // Rebuilds can create word animations. Synchronize the official playback
    // state before the next progress update (also used by its seek detector).
    this.syncPlaybackState(sourceTime);

    if (this.pendingSeek) {
      syncAmlLyricSeekLayout(this.player, timeMs);
      this.lastAppliedTime = timeMs;
      this.pendingSeek = false;
    } else {
      this.applyCurrentTime(timeMs, this.pendingTimeSync && !replacingLines && !rebuildingLines);
      if (refreshingLayout) this.player.update(0);
    }
    this.pendingTimeSync = false;
  }

  private stopFrames() {
    if (this.frameId !== null) {
      this.scheduler.cancelFrame(this.frameId);
      this.frameId = null;
    }
    this.lastFrameTime = null;
  }

  private startFrames() {
    if (!this.canRender || this.frameId !== null) return;
    this.frameId = this.scheduler.requestFrame(this.onFrame);
  }

  private readonly onFrame = (frameTime: number) => {
    this.frameId = null;
    if (!this.canRender) return;

    const delta = this.lastFrameTime === null ? 0 : Math.max(0, frameTime - this.lastFrameTime);
    const sourceTime = this.currentTime(frameTime);
    this.syncPlaybackState(sourceTime);
    this.applyCurrentTime(sourceTime);
    this.player.update(delta);
    this.lastFrameTime = frameTime;
    this.startFrames();
  };

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.canRender) {
      this.flushPending();
      this.startFrames();
    } else {
      this.player.pause();
      this.appliedPlaybackState = false;
    }
  }

  setLyricLines(lines: LyricLine[], timeMs = this.currentTime()) {
    if (this.disposed) return;
    this.reanchor(timeMs);
    this.pendingLines = lines;
    this.flushPending();
  }

  syncCurrentTime(timeMs: number, force = false) {
    if (this.disposed) return;
    const nextTime = normalizeClockTime(timeMs);

    if (
      !force && this.canRender && this.playing
      && Math.abs(nextTime - this.currentTime()) <= AML_CLOCK_SYNC_DRIFT_MS
    ) return;

    this.reanchor(nextTime);
    this.pendingTimeSync ||= force;
    this.flushPending();
  }

  seek(timeMs: number) {
    if (this.disposed) return;
    this.reanchor(timeMs);
    this.pendingSeek = true;
    this.flushPending();
  }

  setPlaying(playing: boolean, timeMs = this.currentTime()) {
    if (this.disposed || this.playing === playing) return;
    this.reanchor(timeMs);
    this.playing = playing;
    this.pendingPlaybackState = true;
    this.flushPending();
  }

  setRenderingState(
    state: { disabled: boolean; lowPower: boolean },
    timeMs = this.currentTime(),
  ) {
    if (this.disposed) return;
    const wasRendering = this.canRender;
    this.disabled = state.disabled;
    this.lowPower = state.lowPower;
    if (wasRendering === this.canRender) return;

    this.reanchor(timeMs);
    this.pendingTimeSync = true;
    this.pendingPlaybackState = true;
    if (!this.canRender) {
      this.stopFrames();
      // Stop upstream Web Animations while hidden, not only our RAF loop.
      this.player.pause();
      this.appliedPlaybackState = false;
      return;
    }

    this.flushPending();
    this.startFrames();
  }

  refreshLayout() {
    if (this.disposed) return;
    this.pendingRebuild = true;
    this.pendingMeasurements = true;
    this.pendingTimeSync = true;
    this.flushPending();
  }

  refreshMeasurements() {
    if (this.disposed) return;
    this.pendingMeasurements = true;
    this.flushPending();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFrames();
    this.pendingLines = null;
    this.player.dispose();
  }
}
