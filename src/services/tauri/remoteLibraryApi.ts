import type {
  RemoteCacheUsage,
  RemoteConnectionResult,
  RemoteFileEntry,
  RemoteSource,
  RemoteSourceInput,
  RemoteSyncResult,
} from '../../types';
import { tauriInvoke } from './invoke';

export const remoteLibraryApi = {
  getRemoteSources: (): Promise<RemoteSource[]> => tauriInvoke('get_remote_sources'),
  testRemoteSource: (source: RemoteSourceInput): Promise<RemoteConnectionResult> =>
    tauriInvoke('test_remote_source', { source }),
  addRemoteSource: (source: RemoteSourceInput): Promise<RemoteSource> =>
    tauriInvoke('add_remote_source', { source }),
  updateRemoteSource: (source: RemoteSourceInput): Promise<RemoteSource> =>
    tauriInvoke('update_remote_source', { source }),
  removeRemoteSource: (sourceId: string): Promise<void> =>
    tauriInvoke('remove_remote_source', { sourceId }),
  syncRemoteSource: (sourceId: string): Promise<RemoteSyncResult> =>
    tauriInvoke('sync_remote_source', { sourceId }),
  precacheRemoteSong: (remoteUri: string): Promise<void> =>
    tauriInvoke('precache_remote_song', { remoteUri }),
  getRemoteCacheUsage: (): Promise<RemoteCacheUsage> =>
    tauriInvoke('get_remote_cache_usage'),
  clearRemoteCache: (): Promise<RemoteCacheUsage> =>
    tauriInvoke('clear_remote_cache'),
  listRemoteDirectory: (sourceId: string, path: string): Promise<RemoteFileEntry[]> =>
    tauriInvoke('list_remote_directory', { sourceId, path }),
  previewRemoteDirectory: (source: RemoteSourceInput, path: string): Promise<RemoteFileEntry[]> =>
    tauriInvoke('list_remote_directory', { source, path }),
};
