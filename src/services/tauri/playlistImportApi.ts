import { tauriInvoke } from './invoke';
import type { FileBinding, SourceInput, SourceTrack } from '../../features/playlistImport/types';

export const playlistImportApi = {
  read: (input: SourceInput) => tauriInvoke('read_playlist_source', { input }),
  match: (tracks: SourceTrack[]) => tauriInvoke('match_playlist_tracks', { tracks }),
  prepare: (playlistId: string, paths: string[]) => tauriInvoke('prepare_playlist_paths', { playlistId, paths }),
  configure: (bindings: FileBinding[], retained: { id: string; paths: string[] }[]) =>
    tauriInvoke('configure_playlist_files', { bindings, retained }),
  export: (path: string, paths: string[], relative = true) => tauriInvoke('export_playlist_m3u8', { path, paths, relative }),
};
