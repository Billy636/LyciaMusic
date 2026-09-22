import type { RouteLocationRaw, Router } from 'vue-router';

type HomeNavigationTarget =
  | { view: 'all' }
  | { view: 'artist' | 'album' | 'playlist'; filter: string }
  | { view: 'folder'; folder?: string }
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
    case 'artist':
    case 'album':
    case 'playlist':
      return {
        path: '/',
        query: {
          view: target.view,
          filter: target.filter,
        },
      };
    case 'folder':
      return {
        path: '/',
        query: target.folder
          ? {
              view: 'folder',
              folder: target.folder,
            }
          : {
              view: 'folder',
            },
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

  const openHomeArtist = (artistName: string, options?: { replace?: boolean }) =>
    openHome({ view: 'artist', filter: artistName }, options);

  const openHomeAlbum = (albumKey: string, options?: { replace?: boolean }) =>
    openHome({ view: 'album', filter: albumKey }, options);

  const openHomePlaylist = (playlistId: string, options?: { replace?: boolean }) =>
    openHome({ view: 'playlist', filter: playlistId }, options);

  const openHomeFolder = (folderPath?: string, options?: { replace?: boolean }) =>
    openHome({ view: 'folder', folder: folderPath }, options);

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
    openHomeArtist,
    openHomeAlbum,
    openHomePlaylist,
    openHomeFolder,
    openHomeStatistics,
    openArtists,
    openAlbums,
    openPlaylists,
    openFavorites,
    openRecent,
    openSettings,
  };
}
