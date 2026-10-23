import { computed, type Ref } from 'vue';

import type { AlbumCatalogItem, ArtistCatalogItem } from '../../types';
import { compareByAlphabetIndex } from '../../utils/alphabetIndex';
import type { AlbumSortMode, ArtistSortMode } from '../../services/storage/playerStorage';
import { matchesPinyinSearch } from '../../utils/pinyinSearch';
import {
  type AlbumListItem,
  type ArtistListItem,
} from './playerLibraryViewShared';

interface UseLibraryCatalogSelectorsOptions {
  artistCatalog: Ref<ArtistCatalogItem[]>;
  albumCatalog: Ref<AlbumCatalogItem[]>;
  metadataAlbumCatalog: Ref<AlbumCatalogItem[]>;
  searchQuery: Ref<string>;
  artistSortMode: Ref<ArtistSortMode>;
  albumSortMode: Ref<AlbumSortMode>;
  albumArtistSortMode: Ref<ArtistSortMode>;
  albumCustomOrder: Ref<string[]>;
}

export function useLibraryCatalogSelectors({
  artistCatalog,
  albumCatalog,
  metadataAlbumCatalog,
  searchQuery,
  artistSortMode,
  albumSortMode,
  albumArtistSortMode,
  albumCustomOrder,
}: UseLibraryCatalogSelectorsOptions) {
  const sortArtists = (items: ArtistListItem[], mode: ArtistSortMode) => {
    const list = [...items];

    if (mode === 'name' || mode === 'name_desc') {
      const direction = mode === 'name_desc' ? -1 : 1;
      list.sort((a, b) => direction * compareByAlphabetIndex(a.name, b.name));
    } else {
      list.sort((a, b) => (mode === 'count_asc' ? a.count - b.count : b.count - a.count)
        || compareByAlphabetIndex(a.name, b.name));
    }

    return list;
  };

  const artistList = computed(() => sortArtists(
    artistCatalog.value, artistSortMode.value,
  ));

  const albumArtistList = computed<ArtistListItem[]>(() => {
    // Match SQLite's NOCASE comparison, which folds ASCII letters only.
    const nameKey = (name: string) => name.trim().replace(/[A-Z]/g, letter => letter.toLowerCase());
    const knownArtists = new Map(artistCatalog.value.map(artist => [nameKey(artist.name), artist]));
    const artists = new Map<string, ArtistListItem>();

    // Use the complete metadata catalog, including artists absent from track credits.
    for (const album of metadataAlbumCatalog.value) {
      const name = album.artist.trim() || 'Unknown';
      const key = nameKey(name);
      const existing = artists.get(key);
      if (existing) {
        existing.count += album.count;
        continue;
      }
      const artist = knownArtists.get(key);
      artists.set(key, {
        id: artist?.id ?? 0,
        name: artist?.name ?? name,
        count: album.count,
        firstSongPath: album.firstSongPath,
        avatarPath: artist?.avatarPath ?? null,
      });
    }

    return sortArtists([...artists.values()], albumArtistSortMode.value);
  });

  const albumList = computed<AlbumListItem[]>(() => {
    const list = [...albumCatalog.value];

    if (albumSortMode.value === 'name') {
      list.sort((a, b) => compareByAlphabetIndex(a.name, b.name));
    } else if (albumSortMode.value === 'custom') {
      const orderMap = new Map(albumCustomOrder.value.map((key, index) => [key, index]));
      list.sort((a, b) => {
        const left = orderMap.has(a.key) ? orderMap.get(a.key)! : Number.MAX_SAFE_INTEGER;
        const right = orderMap.has(b.key) ? orderMap.get(b.key)! : Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    } else if (albumSortMode.value === 'count') {
      list.sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.artist, b.artist));
    } else {
      list.sort((a, b) => {
        const artistDiff = compareByAlphabetIndex(a.artist, b.artist);
        return artistDiff !== 0 ? artistDiff : compareByAlphabetIndex(a.name, b.name);
      });
    }

    return list;
  });

  const filteredArtistList = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) {
      return artistList.value;
    }

    return artistList.value.filter(artist => matchesPinyinSearch([artist.name || ''], query));
  });

  const filteredAlbumArtistList = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    return query
      ? albumArtistList.value.filter(artist => matchesPinyinSearch([artist.name], query))
      : albumArtistList.value;
  });

  const filteredAlbumList = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) {
      return albumList.value;
    }

    return albumList.value.filter(album => matchesPinyinSearch([
      album.name || '',
      album.artist || '',
    ], query));
  });

  return {
    artistList,
    albumArtistList,
    albumList,
    filteredArtistList,
    filteredAlbumArtistList,
    filteredAlbumList,
  };
}
