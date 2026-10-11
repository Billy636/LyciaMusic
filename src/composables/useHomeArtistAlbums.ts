import { ref, watch, type Ref } from 'vue';

import type { AlbumCatalogItem, Song } from '../types';
import { tauriInvoke } from '../services/tauri/invoke';
import { compareByAlphabetIndex } from '../utils/alphabetIndex';
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
  albumSortMode: Ref<'count' | 'name' | 'artist' | 'custom'>;
  albumCustomOrder: Ref<string[]>;
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
  albumCustomOrder,
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

    if (albumSortMode.value === 'name') {
      albums.sort((left, right) => compareByAlphabetIndex(left.name, right.name));
    } else if (albumSortMode.value === 'custom') {
      const orderMap = new Map(albumCustomOrder.value.map((key, index) => [key, index]));
      albums.sort((left, right) => {
        const leftIndex = orderMap.has(left.key)
          ? orderMap.get(left.key)!
          : Number.MAX_SAFE_INTEGER;
        const rightIndex = orderMap.has(right.key)
          ? orderMap.get(right.key)!
          : Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    } else if (albumSortMode.value === 'artist') {
      albums.sort((left, right) => {
        const artistDiff = compareByAlphabetIndex(left.artist, right.artist);
        return artistDiff !== 0
          ? artistDiff
          : compareByAlphabetIndex(left.name, right.name);
      });
    } else {
      albums.sort(
        (left, right) =>
          right.count - left.count || compareByAlphabetIndex(left.artist, right.artist),
      );
    }

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
    [albumSortMode, albumCustomOrder],
    () => {
      artistAlbumList.value = sortAlbums(artistAlbumList.value);
    },
    { deep: true },
  );

  return {
    artistAlbumList,
  };
}
