import { onScopeDispose, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from '../library/store';
import { playlistImportApi } from '../../services/tauri/playlistImportApi';
import type { FileBinding, PlaylistFileUpdate } from './types';

export function includeImportedPaths(paths: string[]) {
  const library = useLibraryStore();
  if (!paths.length) return;
  const canonical = new Set(library.canonicalSongPaths);
  const added = paths.filter(path => !canonical.has(path));
  if (added.length) {
    library.setCanonicalSongOrder([...library.canonicalSongPaths, ...added]);
    library.setSourceSongOrder([...library.sourceSongPaths, ...added]);
  }
}

export function usePlaylistFileBridge() {
  const collections = useCollectionsStore();
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { bindings: FileBinding[]; retained: { id: string; paths: string[] }[] } | undefined;
  let lastConfiguration: typeof pending;
  let sending = false;

  const send = async () => {
    if (sending || !pending || disposed) return;
    sending = true;
    const value = pending;
    lastConfiguration = value;
    pending = undefined;
    try { await playlistImportApi.configure(value.bindings, value.retained); }
    catch (error) {
      for (const binding of value.bindings) {
        const data = collections.playlists.find(p => p.id === binding.id)?.importData;
        if (data?.revision === binding.revision) data.error = `自动刷新未启动：${String(error)}`;
      }
    } finally {
      sending = false;
      if (pending && !disposed) void send();
    }
  };

  const ready = listen<PlaylistFileUpdate>('playlist-file-updated', ({ payload }) => {
    if (disposed) return;
    const playlist = collections.playlists.find(p => p.id === payload.id);
    const data = playlist?.importData;
    if (!playlist || !data?.linked || data.revision !== payload.revision) return;
    data.error = payload.error;
    if (!payload.document) return;
    const available = new Set(payload.playablePaths);
    data.document = payload.document;
    data.choices = payload.document.tracks.map(track => track.path && available.has(track.path) ? track.path : null);
    data.ignored = [];
    data.updatedAt = new Date().toISOString();
    playlist.songPaths = data.choices.filter((path): path is string => !!path);
    includeImportedPaths(payload.playablePaths);
  }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(error => console.warn('Playlist file listener:', error));

  watch(() => JSON.stringify(collections.initialized ? collections.playlists.filter(p => p.importData).map(p => ({
    id: p.id,
    binding: p.importData!.linked ? { id: p.id, path: p.importData!.document.source, revision: p.importData!.revision, mapping: p.importData!.mapping } : null,
    paths: p.importData!.linked
      ? [...new Set([...p.importData!.document.tracks.flatMap(t => t.path && !t.path.includes('://') ? [t.path] : []), ...p.songPaths])] : p.songPaths,
  })) : null), async value => {
    if (value === 'null') return;
    await ready;
    if (disposed) return;
    const items = JSON.parse(value) as { id: string; binding: FileBinding | null; paths: string[] }[];
    pending = { bindings: items.flatMap(p => p.binding ? [p.binding] : []), retained: items.map(p => ({ id: p.id, paths: p.paths })) };
    clearTimeout(timer);
    timer = setTimeout(() => void send(), 150);
  }, { immediate: true });

  const checkOnFocus = () => {
    if (lastConfiguration && !disposed) {
      pending ??= lastConfiguration;
      void send();
    }
  };
  window.addEventListener('focus', checkOnFocus);

  onScopeDispose(() => {
    disposed = true;
    unlisten?.();
    clearTimeout(timer);
    window.removeEventListener('focus', checkOnFocus);
  });
}
