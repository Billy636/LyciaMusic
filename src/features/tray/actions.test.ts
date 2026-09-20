import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { handleTrayMenuAction, type TrayMenuActionDeps } from './actions';

const createDeps = (): TrayMenuActionDeps => ({
  prevSong: vi.fn(),
  togglePlay: vi.fn().mockResolvedValue(undefined),
  nextSong: vi.fn(),
  playMode: ref(0),
  isMiniMode: ref(false),
  showDesktopLyrics: ref(false),
  revealMainWindow: vi.fn().mockResolvedValue(undefined),
  openSettings: vi.fn().mockResolvedValue(undefined),
  quitApp: vi.fn().mockResolvedValue(undefined),
});

describe('tray menu actions', () => {
  it('maps playback control actions to playback handlers', async () => {
    const deps = createDeps();

    await handleTrayMenuAction('prev-song', deps);
    await handleTrayMenuAction('toggle-play', deps);
    await handleTrayMenuAction('next-song', deps);

    expect(deps.prevSong).toHaveBeenCalledTimes(1);
    expect(deps.togglePlay).toHaveBeenCalledTimes(1);
    expect(deps.nextSong).toHaveBeenCalledTimes(1);
  });

  it('applies tray-only state actions', async () => {
    const deps = createDeps();

    await handleTrayMenuAction('play-mode-shuffle', deps);
    await handleTrayMenuAction('toggle-mini-player', deps);
    await handleTrayMenuAction('toggle-desktop-lyrics', deps);
    await handleTrayMenuAction('open-settings', deps);

    expect(deps.playMode.value).toBe(2);
    expect(deps.isMiniMode.value).toBe(false);
    expect(deps.showDesktopLyrics.value).toBe(true);
    expect(deps.revealMainWindow).toHaveBeenCalledTimes(1);
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
  });

  it('toggles mini player off and reveals the main window', async () => {
    const deps = createDeps();
    deps.isMiniMode.value = true;

    await handleTrayMenuAction('toggle-mini-player', deps);

    expect(deps.isMiniMode.value).toBe(false);
    expect(deps.revealMainWindow).toHaveBeenCalledTimes(1);
  });

  it('toggles mini player on without revealing the main window', async () => {
    const deps = createDeps();

    await handleTrayMenuAction('toggle-mini-player', deps);

    expect(deps.isMiniMode.value).toBe(true);
    expect(deps.revealMainWindow).not.toHaveBeenCalled();
  });

  it('toggles desktop lyrics off from the tray', async () => {
    const deps = createDeps();
    deps.showDesktopLyrics.value = true;

    await handleTrayMenuAction('toggle-desktop-lyrics', deps);

    expect(deps.showDesktopLyrics.value).toBe(false);
  });
});
