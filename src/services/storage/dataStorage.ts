import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { tauriInvoke } from '../tauri/invoke';

let webviewDataDirectory: string | undefined;

export const getWebviewDataDirectory = () => webviewDataDirectory;

export async function initializeDataStorage() {
  if (!isTauri()) return null;
  const info = await tauriInvoke('get_data_storage_info');
  webviewDataDirectory = info.webviewPath;
  if (!info.pathMappings.length) return info;
  const migrationKey = 'lycia.data-storage.paths';
  const signature = JSON.stringify(info.pathMappings);
  if (localStorage.getItem(migrationKey) === signature) return info;

  const mappings = info.pathMappings.flatMap(([from, to]) => {
    const oldPath = from.replace(/\\/g, '/');
    const newPath = to.replace(/\\/g, '/');
    return [
      [oldPath, newPath],
      [convertFileSrc(from).replace(/\/$/, ''), convertFileSrc(to).replace(/\/$/, '')],
      [convertFileSrc(oldPath).replace(/\/$/, ''), convertFileSrc(newPath).replace(/\/$/, '')],
    ] as [string, string][];
  }).sort((a, b) => b[0].length - a[0].length);

  const rebase = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const normalized = value.replace(/\\/g, '/');
      for (const [from, to] of mappings) {
        if (normalized.startsWith(from) && /^(?:\/|%2f|%5c|$)/i.test(normalized.slice(from.length))) {
          return `${to}${normalized.slice(from.length)}`;
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(rebase);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item)]));
    }
    return value;
  };

  // Run before importing stores: fonts, backgrounds and collection images can contain absolute paths.
  for (const key of Object.keys(localStorage)) {
    if (key === migrationKey) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let value: unknown;
    let json = true;
    try { value = JSON.parse(raw); } catch { value = raw; json = false; }
    const updated = rebase(value);
    const next = json ? JSON.stringify(updated) : String(updated);
    if (next !== raw) localStorage.setItem(key, next);
  }
  localStorage.setItem(migrationKey, signature);
  return info;
}
