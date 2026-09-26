const SYNC_DRIFT_SECONDS = 0.35;

/** Signed lyric time preserves positive audio-delay preroll before the first cue. */
export function createLightPlaybackClock(initialTime: number, now = () => performance.now()) {
  let anchorTime = Number.isFinite(initialTime) ? initialTime : 0;
  let anchorFrameTime = now();

  function current(playing: boolean, frameTime = now()) {
    return anchorTime + (playing ? Math.max(0, frameTime - anchorFrameTime) / 1000 : 0);
  }

  function reanchor(time: number) {
    anchorTime = Number.isFinite(time) ? time : 0;
    anchorFrameTime = now();
  }

  function sync(time: number, playing: boolean, force = false, localFramesRunning = true) {
    if (!Number.isFinite(time)) return false;
    if (!force && playing && localFramesRunning
      && Math.abs(time - current(playing)) <= SYNC_DRIFT_SECONDS) return false;
    reanchor(time);
    return true;
  }

  return { current, reanchor, sync };
}
