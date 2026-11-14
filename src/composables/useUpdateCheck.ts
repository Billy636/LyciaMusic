import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readonly, shallowRef } from 'vue';
import { localStore } from '../services/storage/localStore';
import { compareVersions, fetchLatestRelease, fetchOfficialLatestRelease, type ReleaseInfo } from '../utils/update';

export interface UpdateCheckResult {
  currentVersion: string;
  release: ReleaseInfo;
  comparison: number;
}

const startupUpdate = shallowRef<UpdateCheckResult | null>(null);
let inFlight: Promise<UpdateCheckResult> | null = null;
let startupScheduled = false;
let startupDismissed = false;
const IGNORED_STARTUP_VERSIONS_KEY = 'ignored_startup_update_versions';

function validateVersion(version: string) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error('Invalid update version');
  }
}

function readIgnoredStartupVersions(): string[] {
  const stored = localStore.getJson<unknown>(IGNORED_STARTUP_VERSIONS_KEY);
  return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
}

function isStartupVersionIgnored(version: string): boolean {
  try {
    return readIgnoredStartupVersions().includes(version);
  } catch (error) {
    console.warn('Failed to read ignored update versions:', error);
    return false;
  }
}

/** Only an explicit choice suppresses this version across future app launches. */
export function ignoreStartupUpdateVersion(version: string): boolean {
  try {
    validateVersion(version);
    if (typeof localStorage === 'undefined') return false;
    const versions = readIgnoredStartupVersions();
    localStore.setJson(IGNORED_STARTUP_VERSIONS_KEY, [...new Set([...versions, version])]);
    return true;
  } catch (error) {
    console.warn('Failed to save ignored update version:', error);
    return false;
  }
}

function validateRelease(release: ReleaseInfo): ReleaseInfo {
  validateVersion(release.version);
  if (new URL(release.url).protocol !== 'https:') {
    throw new Error('Invalid update URL');
  }
  return release;
}

async function fetchUpdateCheck(): Promise<UpdateCheckResult> {
  // Never compare a failed version lookup (e.g. "Unknown") as version zero.
  const currentVersion = await getVersion();
  validateVersion(currentVersion);
  let release: ReleaseInfo;
  try {
    release = validateRelease(await fetchLatestRelease('Billy636', 'LyciaMusic'));
  } catch {
    release = validateRelease(await fetchOfficialLatestRelease());
  }
  return {
    currentVersion,
    release,
    comparison: compareVersions(release.version, currentVersion),
  };
}

function sharedUpdateCheck() {
  if (!inFlight) {
    inFlight = fetchUpdateCheck().finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function dismissStartupUpdate() {
  startupDismissed = true;
  startupUpdate.value = null;
}

/** Manual checks take precedence over any pending startup notification. */
export function checkForUpdates() {
  dismissStartupUpdate();
  return sharedUpdateCheck();
}

/** Schedule once per main-window session; tray restores and route changes do not recheck. */
export function startStartupUpdateCheck(isEnabled: () => boolean): () => void {
  if (!isTauri() || getCurrentWindow().label !== 'main' || startupScheduled || startupDismissed) {
    return () => {};
  }
  startupScheduled = true;
  if (!isEnabled()) return () => {};

  let disposed = false;
  const timer = setTimeout(() => {
    if (disposed || startupDismissed || !isEnabled()) return;
    void sharedUpdateCheck().then(result => {
      if (!disposed && !startupDismissed && isEnabled() && result.comparison > 0
        && !isStartupVersionIgnored(result.release.version)) {
        startupUpdate.value = result;
      }
    }).catch(error => {
      // Startup failures are deliberately silent and must not reach the fatal-error handler.
      console.warn('Startup update check failed:', error);
    });
  }, 3000);

  return () => {
    disposed = true;
    clearTimeout(timer);
    dismissStartupUpdate();
  };
}

export function useStartupUpdateNotice() {
  return { startupUpdate: readonly(startupUpdate), dismissStartupUpdate };
}
