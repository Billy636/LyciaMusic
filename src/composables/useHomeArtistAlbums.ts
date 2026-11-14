import { ref, watch, type Ref } from 'vue';

import type { AlbumCatalogItem, Song } from '../types';
import { tauriInvoke } from '../services/tauri/invoke';
import { compareAlbumsByMode } from '../features/library/playerLibraryViewShared';
import type { AlbumSortMode } from '../services/storage/playerStorage';
import type { ArtistBrowseMode } from '../shared/stores/navigation';

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface UseHomeArtistAlbumsOptions {
  localFilterCondition: Ref<string>;
  filterCondition: Ref<string>;
  currentArtistBrowseMode: Ref<ArtistBrowseMode>;
  librarySongs: Ref<Song[]>;
  albumSortMode: Ref<AlbumSortMode>;
}

const songHasArtistName = (song: Song, artistName: string) =>
  (
    song.effective_artist_names?.length
      ? song.effective_artist_names
      : song.artist_names || [song.artist]
  ).includes(artistName);

export function useHomeArtistAlbums({
  localFilterCondition,
  filterCondition,
  currentArtistBrowseMode,
  librarySongs,
  albumSortMode,
}: UseHomeArtistAlbumsOptions) {
  const artistAlbumList = ref<ArtistAlbumItem[]>([]);
  let requestId = 0;

  const buildLegacyAlbumList = (artistName: string) => {
    const albumMap = new Map<string, ArtistAlbumItem>();

    librarySongs.value.forEach(song => {
      const matchesArtist = currentArtistBrowseMode.value === 'albumArtist'
        ? (song.album_artist?.trim() || song.artist?.trim() || 'Unknown').toLowerCase() === artistName.toLowerCase()
        : songHasArtistName(song, artistName);
      if (!matchesArtist) {
        return;
      }

      const albumKey =
        song.album_key ||
        `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;
      const existing = albumMap.get(albumKey);

      if (existing) {
        existing.count += 1;
        return;
      }

      albumMap.set(albumKey, {
        key: albumKey,
        name: song.album || 'Unknown',
        count: 1,
        artist: song.album_artist || song.artist || 'Unknown',
        firstSongPath: song.path,
      });
    });

    return Array.from(albumMap.values());
  };

  const sortAlbums = (items: AlbumCatalogItem[] | ArtistAlbumItem[]) => {
    const albums: ArtistAlbumItem[] = items.map(item => ({ ...item }));

    albums.sort((left, right) => compareAlbumsByMode(left, right, albumSortMode.value));

    return albums;
  };

  watch(
    [localFilterCondition, filterCondition, currentArtistBrowseMode],
    async () => {
      const currentRequestId = ++requestId;
      const artistName = localFilterCondition.value || filterCondition.value;
      if (!artistName) {
        artistAlbumList.value = [];
        return;
      }

      try {
        const albums = await tauriInvoke('get_library_album_catalog_by_artist', {
          artistName,
          ...(currentArtistBrowseMode.value === 'albumArtist' ? { albumArtist: true } : {}),
        });
        if (currentRequestId === requestId) {
          artistAlbumList.value = sortAlbums(albums);
        }
      } catch {
        // Compatibility fallback for older backends and unit-test fixtures.
        if (currentRequestId === requestId) {
          artistAlbumList.value = sortAlbums(buildLegacyAlbumList(artistName));
        }
      }
    },
    { immediate: true },
  );

  watch(
    albumSortMode,
    () => {
      artistAlbumList.value = sortAlbums(artistAlbumList.value);
    },
  );

  return {
    artistAlbumList,
  };
}
