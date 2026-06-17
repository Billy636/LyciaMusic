import { invoke, isTauri } from '@tauri-apps/api/core';

const VERSION_PATTERN = /\d+(?:\.\d+)+/;
export const OFFICIAL_LATEST_RELEASE_URL = 'https://lycia.prettyboy.fun/latest.json';

type ReleaseSource = 'official' | 'github';

export interface ReleaseInfo {
  version: string;
  url: string;
  downloadUrl?: string;
  changelogUrl?: string;
  publishedAt?: string;
  notes?: string;
  source?: ReleaseSource;
}

export function extractVersion(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(VERSION_PATTERN);
  return match ? match[0] : trimmed.replace(/^[vV]/, '');
}

export function compareVersions(left: string, right: string): number {
  const leftParts = extractVersion(left).split('.').map(part => Number.parseInt(part, 10) || 0);
  const rightParts = extractVersion(right).split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function resolveReleaseUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

type UpdateSourceType = 'official' | 'github';

async function fetchUpdateJson<T>(
  source: UpdateSourceType,
  fallbackUrl: string,
  headers?: Record<string, string>
): Promise<T> {
  if (isTauri()) {
    try {
      const rawJson = await invoke<string>('check_update_by_rust', { source });
      return JSON.parse(rawJson);
    } catch (error) {
      throw Object.assign(
        new Error(`[Rust Backend] ${error instanceof Error ? error.message : String(error)}`),
        { cause: error },
      );
    }
  } else {
    const response = await fetch(fallbackUrl, { headers });
    if (!response.ok) {
      throw new Error(`[Browser Fetch] HTTP status ${response.status}`);
    }
    return await response.json();
  }
}

export async function fetchOfficialLatestRelease(endpoint = OFFICIAL_LATEST_RELEASE_URL): Promise<ReleaseInfo> {
  const payload = await fetchUpdateJson<any>('official', endpoint, {
    Accept: 'application/json'
  });
  const version = typeof payload.version === 'string' ? extractVersion(payload.version) : '';

  if (!version) {
    throw new Error('Official latest release version is missing');
  }

  const rawDownloadUrl = typeof payload.downloadUrl === 'string'
    ? payload.downloadUrl
    : typeof payload.download_url === 'string'
      ? payload.download_url
      : '';

  if (!rawDownloadUrl) {
    throw new Error('Official latest release download URL is missing');
  }

  const downloadUrl = resolveReleaseUrl(rawDownloadUrl, endpoint);
  const rawChangelogUrl = typeof payload.changelogUrl === 'string'
    ? payload.changelogUrl
    : typeof payload.changelog_url === 'string'
      ? payload.changelog_url
      : undefined;
  const changelogUrl = rawChangelogUrl ? resolveReleaseUrl(rawChangelogUrl, endpoint) : undefined;
  const changelog = Array.isArray(payload.changelog)
    ? payload.changelog.filter((item: unknown): item is string => typeof item === 'string')
    : [];

  return {
    version,
    url: downloadUrl,
    downloadUrl,
    changelogUrl,
    publishedAt: typeof payload.date === 'string' ? payload.date : undefined,
    notes: changelog.length > 0 ? changelog.join('\n') : undefined,
    source: 'official'
  };
}

export async function fetchLatestRelease(owner: string, repo: string): Promise<ReleaseInfo> {
  const fallbackUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const payload = await fetchUpdateJson<any>('github', fallbackUrl, {
    Accept: 'application/vnd.github+json'
  });

  const versionSource = typeof payload.tag_name === 'string' ? payload.tag_name : payload.name;
  const version = typeof versionSource === 'string' ? extractVersion(versionSource) : '';

  if (!version) {
    throw new Error('Latest release version is missing');
  }

  return {
    version,
    url: typeof payload.html_url === 'string' ? payload.html_url : `https://github.com/${owner}/${repo}/releases`,
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : undefined,
    notes: typeof payload.body === 'string' ? payload.body : undefined,
    source: 'github'
  };
}
