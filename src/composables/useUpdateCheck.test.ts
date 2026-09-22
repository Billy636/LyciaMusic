import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseInfo } from '../utils/update';

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  isTauri: vi.fn(),
  getCurrentWindow: vi.fn(),
  github: vi.fn(),
  official: vi.fn(),
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getCurrentWindow }));
vi.mock('../utils/update', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/update')>(),
  fetchLatestRelease: mocks.github,
  fetchOfficialLatestRelease: mocks.official,
}));

const release: ReleaseInfo = {
  version: '1.4.0',
  url: 'https://github.com/Billy636/LyciaMusic/releases/tag/v1.4.0',
  notes: '修复播放问题',
  source: 'github',
};

let api: typeof import('./useUpdateCheck');

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.getVersion.mockResolvedValue('1.3.12');
  mocks.isTauri.mockReturnValue(true);
  mocks.getCurrentWindow.mockReturnValue({ label: 'main' });
  mocks.github.mockResolvedValue(release);
  mocks.official.mockResolvedValue({ ...release, source: 'official' });
  api = await import('./useUpdateCheck');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared update checks', () => {
  it('checks GitHub first and compares the actual app version', async () => {
    await expect(api.checkForUpdates()).resolves.toEqual({ currentVersion: '1.3.12', release, comparison: 1 });
    expect(mocks.github).toHaveBeenCalledWith('Billy636', 'LyciaMusic');
    expect(mocks.official).not.toHaveBeenCalled();
  });

  it('falls back to the official source when GitHub fails', async () => {
    mocks.github.mockRejectedValue(new Error('offline'));
    expect((await api.checkForUpdates()).release.source).toBe('official');
    expect(mocks.official).toHaveBeenCalledOnce();
  });

  it.each([
    { ...release, version: 'Unknown' },
    { ...release, url: 'file:///installer.exe' },
  ])('falls back when release metadata is invalid: %j', async invalid => {
    mocks.github.mockResolvedValue(invalid);
    expect((await api.checkForUpdates()).release.source).toBe('official');
  });

  it('shares concurrent requests but allows later manual retries', async () => {
    const first = api.checkForUpdates();
    const second = api.checkForUpdates();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(mocks.github).toHaveBeenCalledOnce();
    await api.checkForUpdates();
    expect(mocks.github).toHaveBeenCalledTimes(2);
  });

  it('surfaces manual failures and clears the failed request for retry', async () => {
    mocks.github.mockRejectedValueOnce(new Error('offline'));
    mocks.official.mockRejectedValueOnce(new Error('offline'));
    await expect(api.checkForUpdates()).rejects.toThrow('offline');
    await expect(api.checkForUpdates()).resolves.toMatchObject({ comparison: 1 });
  });

  it('does not treat an unknown local version as zero', async () => {
    mocks.getVersion.mockResolvedValue('Unknown');
    await expect(api.checkForUpdates()).rejects.toThrow('Invalid update version');
    expect(mocks.github).not.toHaveBeenCalled();
  });
});

describe('startup update checks', () => {
  it('waits three seconds, checks once, and exposes release notes', async () => {
    api.startStartupUpdateCheck(() => true);
    api.startStartupUpdateCheck(() => true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.getVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.github).toHaveBeenCalledOnce();
    expect(api.useStartupUpdateNotice().startupUpdate.value?.release.notes).toBe(release.notes);
    api.dismissStartupUpdate();
    api.startStartupUpdateCheck(() => true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.github).toHaveBeenCalledOnce();
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
  });

  it.each(['mini-player', 'desktop-lyrics', 'tray-menu', 'taskbar-player'])('does not run in %s', async label => {
    mocks.getCurrentWindow.mockReturnValue({ label });
    api.startStartupUpdateCheck(() => true);
    await vi.runAllTimersAsync();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it('does not run in a browser preview', async () => {
    mocks.isTauri.mockReturnValue(false);
    api.startStartupUpdateCheck(() => true);
    await vi.runAllTimersAsync();
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it('respects a saved disabled preference', async () => {
    api.startStartupUpdateCheck(() => false);
    await vi.runAllTimersAsync();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it('rechecks the preference before sending the request', async () => {
    let enabled = true;
    api.startStartupUpdateCheck(() => enabled);
    enabled = false;
    await vi.runAllTimersAsync();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it.each(['1.3.12', '1.2.0'])('stays silent for release %s', async version => {
    mocks.github.mockResolvedValue({ ...release, version });
    api.startStartupUpdateCheck(() => true);
    await vi.runAllTimersAsync();
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
  });

  it('handles network errors silently without an unhandled rejection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.github.mockRejectedValue(new Error('offline'));
    mocks.official.mockRejectedValue(new Error('offline'));
    api.startStartupUpdateCheck(() => true);
    await vi.runAllTimersAsync();
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
  });

  it('cancels the timer on unmount', async () => {
    const dispose = api.startStartupUpdateCheck(() => true);
    dispose();
    await vi.runAllTimersAsync();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it.each(['dispose', 'disable', 'manual'] as const)('suppresses a late response after %s', async action => {
    let resolve!: (release: ReleaseInfo) => void;
    mocks.github.mockReturnValue(new Promise<ReleaseInfo>(done => { resolve = done; }));
    let enabled = true;
    const dispose = api.startStartupUpdateCheck(() => enabled);
    await vi.advanceTimersByTimeAsync(3000);
    let manual: ReturnType<typeof api.checkForUpdates> | undefined;
    if (action === 'dispose') dispose();
    if (action === 'disable') enabled = false;
    if (action === 'manual') manual = api.checkForUpdates();
    resolve(release);
    await vi.runAllTimersAsync();
    if (manual) await expect(manual).resolves.toMatchObject({ comparison: 1 });
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
    expect(mocks.github).toHaveBeenCalledOnce();
  });

  it('does not check again when the user checked manually before the timer fires', async () => {
    api.startStartupUpdateCheck(() => true);
    await api.checkForUpdates();
    await vi.runAllTimersAsync();
    expect(mocks.github).toHaveBeenCalledOnce();
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
  });

  it('closes an existing startup notice when checking manually', async () => {
    api.startStartupUpdateCheck(() => true);
    await vi.runAllTimersAsync();
    expect(api.useStartupUpdateNotice().startupUpdate.value).not.toBeNull();
    await api.checkForUpdates();
    expect(api.useStartupUpdateNotice().startupUpdate.value).toBeNull();
  });
});
