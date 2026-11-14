import type { RouteLocationRaw, Router } from 'vue-router';
import type { SidebarNavigationId, SidebarSettings } from '../types';
import { getSidebarHomepageId } from '../features/settings/sidebarNavigation';
import type { ArtistBrowseMode } from '../shared/stores/navigation';

type HomeNavigationTarget =
  | { view: 'all' }
  | { view: 'artist'; filter: string; artistMode?: ArtistBrowseMode }
  | { view: 'album' | 'playlist'; filter: string }
  | { view: 'genre'; filter?: string }
  | { view: 'folder'; folder?: string; collection?: boolean }
  | { view: 'statistics' };

type AppNavigationTarget =
  | { section: 'home'; target: HomeNavigationTarget }
  | { section: 'artists' }
  | { section: 'albums' }
  | { section: 'playlists' }
  | { section: 'favorites' }
  | { section: 'recent' }
  | { section: 'settings' };

const buildHomeLocation = (target: HomeNavigationTarget): RouteLocationRaw => {
  switch (target.view) {
    case 'all':
      return { path: '/', query: { view: 'all' } };
    case 'artist':
    case 'album':
    case 'playlist':
      return {
        path: '/',
        query: {
          view: target.view,
          filter: target.filter,
          ...(target.view === 'artist' && target.artistMode === 'albumArtist'
            ? { artistMode: 'albumArtist' }
            : {}),
        },
      };
    case 'folder':
      return {
        path: '/',
        query: target.folder
          ? {
              view: 'folder',
              folder: target.folder,
              ...(target.collection ? { collection: '1' } : {}),
            }
          : {
              view: 'folder',
            },
      };
    case 'genre':
      return {
        path: '/',
        query: target.filter
          ? { view: 'genre', filter: target.filter }
          : { view: 'genre' },
      };
    case 'statistics':
      return {
        path: '/',
        query: {
          view: 'statistics',
        },
      };
    default:
      return {
        path: '/',
        query: {},
      };
  }
};

export const buildAppLocation = (target: AppNavigationTarget): RouteLocationRaw => {
  switch (target.section) {
    case 'home':
      return buildHomeLocation(target.target);
    case 'artists':
      return { path: '/artists' };
    case 'albums':
      return { path: '/albums' };
    case 'playlists':
      return { path: '/playlists' };
    case 'favorites':
      return { path: '/favorites' };
    case 'recent':
      return { path: '/recent' };
    case 'settings':
      return { path: '/settings' };
    default:
      return { path: '/' };
  }
};

const sidebarTargets: Record<SidebarNavigationId, AppNavigationTarget> = {
  localMusic: { section: 'home', target: { view: 'all' } },
  artists: { section: 'artists' },
  albums: { section: 'albums' },
  genres: { section: 'home', target: { view: 'genre' } },
  playlists: { section: 'playlists' },
  favorites: { section: 'favorites' },
  recent: { section: 'recent' },
  folders: { section: 'home', target: { view: 'folder' } },
  statistics: { section: 'home', target: { view: 'statistics' } },
};

export const buildDefaultHomeLocation = (sidebar: SidebarSettings): RouteLocationRaw => {
  return buildAppLocation(sidebarTargets[getSidebarHomepageId(sidebar)]);
};

export function useHomeNavigation(router: Router) {
  const openApp = async (target: AppNavigationTarget, options: { replace?: boolean } = {}) => {
    const location = buildAppLocation(target);
    if (options.replace) {
      await router.replace(location);
      return;
    }

    await router.push(location);
  };

  const openHome = async (target: HomeNavigationTarget, options: { replace?: boolean } = {}) =>
    openApp({ section: 'home', target }, options);

  const openHomeAll = (options?: { replace?: boolean }) =>
    openHome({ view: 'all' }, options);

  const openHomeDefault = (options: { replace?: boolean } = {}) => {
    const location = { path: '/', query: {} };
    return options.replace ? router.replace(location) : router.push(location);
  };

  const openHomeArtist = (artistName: string, options?: { replace?: boolean; artistMode?: ArtistBrowseMode }) =>
    openHome({ view: 'artist', filter: artistName, artistMode: options?.artistMode }, options);

  const openHomeAlbum = (albumKey: string, options?: { replace?: boolean }) =>
    openHome({ view: 'album', filter: albumKey }, options);

  const openHomePlaylist = (playlistId: string, options?: { replace?: boolean }) =>
    openHome({ view: 'playlist', filter: playlistId }, options);

  const openHomeFolder = (folderPath?: string, options?: { replace?: boolean; collection?: boolean }) =>
    openHome({ view: 'folder', folder: folderPath, collection: options?.collection }, options);

  const openHomeGenre = (genre?: string, options?: { replace?: boolean }) =>
    openHome({ view: 'genre', filter: genre }, options);

  const openHomeStatistics = (options?: { replace?: boolean }) =>
    openHome({ view: 'statistics' }, options);

  const openArtists = (options?: { replace?: boolean }) =>
    openApp({ section: 'artists' }, options);

  const openAlbums = (options?: { replace?: boolean }) =>
    openApp({ section: 'albums' }, options);

  const openPlaylists = (options?: { replace?: boolean }) =>
    openApp({ section: 'playlists' }, options);

  const openFavorites = (options?: { replace?: boolean }) =>
    openApp({ section: 'favorites' }, options);

  const openRecent = (options?: { replace?: boolean }) =>
    openApp({ section: 'recent' }, options);

  const openSettings = (options?: { replace?: boolean }) =>
    openApp({ section: 'settings' }, options);

  return {
    openApp,
    openHome,
    openHomeAll,
    openHomeDefault,
    openHomeArtist,
    openHomeAlbum,
    openHomePlaylist,
    openHomeFolder,
    openHomeGenre,
    openHomeStatistics,
    openArtists,
    openAlbums,
    openPlaylists,
    openFavorites,
    openRecent,
    openSettings,
  };
}
