import { ref, watch, type Ref } from 'vue';
import type {
  LocationQuery,
  LocationQueryRaw,
  RouteLocationNormalizedLoaded,
  Router,
} from 'vue-router';
import type { FolderNode } from '../types';

type SyncedHomeViewMode = 'all' | 'folder' | 'artist' | 'album' | 'playlist' | 'statistics';

interface HomeRouteState {
  viewMode: SyncedHomeViewMode;
  filter: string;
  folder: string;
}

interface UseHomeRouteSyncOptions {
  route: RouteLocationNormalizedLoaded;
  router: Router;
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  currentFolderFilter: Ref<string>;
  folderCollectionPath?: Ref<string>;
  activeRootPath: Ref<string | null>;
  folderTree: Ref<FolderNode[]>;
  searchQuery: Ref<string>;
}

const HOME_QUERY_KEYS = ['view', 'filter', 'folder', 'collection'] as const;

const readQueryString = (value: LocationQuery[string]) => {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return typeof value === 'string' ? value : '';
};

const hasExplicitHomeQuery = (query: LocationQuery) =>
  HOME_QUERY_KEYS.some((key) => query[key] !== undefined);

const parseHomeRouteState = (query: LocationQuery): HomeRouteState => {
  const view = readQueryString(query.view);
  const filter = readQueryString(query.filter);
  const folder = readQueryString(query.folder);

  switch (view) {
    case 'artist':
    case 'album':
    case 'playlist':
      if (!filter) {
        return { viewMode: 'all', filter: '', folder: '' };
      }
      return { viewMode: view, filter, folder: '' };
    case 'folder':
      return { viewMode: 'folder', filter: '', folder };
    case 'statistics':
      return { viewMode: 'statistics', filter: '', folder: '' };
    default:
      return { viewMode: 'all', filter: '', folder: '' };
  }
};

const normalizePath = (path: string | null | undefined) =>
  (path || '').replace(/\\/g, '/').replace(/\/+$/, '');

const findOwningRootPath = (nodes: FolderNode[], targetPath: string) => {
  const normalizedTarget = normalizePath(targetPath);
  const matchedRoots = nodes
    .map((node) => node.path)
    .filter((rootPath) => {
      const normalizedRoot = normalizePath(rootPath);
      return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
    })
    .sort((left, right) => normalizePath(right).length - normalizePath(left).length);

  return matchedRoots[0] || null;
};

const buildHomeRouteQuery = (
  currentViewMode: string,
  filterCondition: string,
  currentFolderFilter: string,
  folderCollectionPath: string,
): LocationQueryRaw => {
  switch (currentViewMode) {
    case 'artist':
    case 'album':
    case 'playlist':
      return filterCondition ? { view: currentViewMode, filter: filterCondition } : {};
    case 'statistics':
      return { view: 'statistics' };
    case 'folder':
      return currentFolderFilter ? {
        view: 'folder',
        folder: currentFolderFilter,
        ...(folderCollectionPath ? { collection: '1' } : {}),
      } : { view: 'folder' };
    default:
      return {};
  }
};

const getComparableHomeQuery = (query: LocationQuery | LocationQueryRaw) => ({
  view: readQueryString(query.view as LocationQuery[string]),
  filter: readQueryString(query.filter as LocationQuery[string]),
  folder: readQueryString(query.folder as LocationQuery[string]),
  collection: readQueryString(query.collection as LocationQuery[string]),
});

export function useHomeRouteSync({
  route,
  router,
  currentViewMode,
  filterCondition,
  currentFolderFilter,
  folderCollectionPath = ref(''),
  activeRootPath,
  folderTree,
}: UseHomeRouteSyncOptions) {
  const resetToDefaultHomeState = () => {
    currentViewMode.value = 'all';
    filterCondition.value = '';
  };

  const applyCollectionRouteState = (viewMode: 'favorites' | 'recent') => {
    currentViewMode.value = viewMode;
    filterCondition.value = '';
  };

  watch(
    [() => route.path, () => route.query.view, () => route.query.filter, () => route.query.folder, () => route.query.collection],
    ([path]) => {
      folderCollectionPath.value = '';
      if (path === '/favorites') {
        applyCollectionRouteState('favorites');
        return;
      }

      if (path === '/recent') {
        applyCollectionRouteState('recent');
        return;
      }

      if (path !== '/') {
        return;
      }

      if (!hasExplicitHomeQuery(route.query)) {
        resetToDefaultHomeState();
        return;
      }

      const nextState = parseHomeRouteState(route.query);
      currentViewMode.value = nextState.viewMode;
      filterCondition.value = nextState.filter;

      if (nextState.viewMode === 'folder') {
        const resolvedFolder =
          nextState.folder ||
          currentFolderFilter.value ||
          folderTree.value[0]?.path ||
          '';

        if (resolvedFolder) {
          currentFolderFilter.value = resolvedFolder;
        }

        if (nextState.folder && readQueryString(route.query.collection) === '1') {
          folderCollectionPath.value = resolvedFolder;
        }

        const rootPath = findOwningRootPath(folderTree.value, resolvedFolder);
        if (rootPath) {
          activeRootPath.value = rootPath;
        }
      }
    },
    { immediate: true },
  );

  watch(
    [() => route.path, currentViewMode, filterCondition, currentFolderFilter, folderCollectionPath],
    ([path]) => {
      if (currentViewMode.value !== 'folder'
        || normalizePath(currentFolderFilter.value).toLowerCase() !== normalizePath(folderCollectionPath.value).toLowerCase()) {
        folderCollectionPath.value = '';
      }

      if (path !== '/') {
        return;
      }

      const baseQuery: LocationQueryRaw = { ...route.query };
      for (const key of HOME_QUERY_KEYS) {
        delete baseQuery[key];
      }

      const nextQuery = {
        ...baseQuery,
        // An explicit local-music selection must not turn into the configurable home entry.
        ...(currentViewMode.value === 'all' && readQueryString(route.query.view) === 'all'
          ? { view: 'all' }
          : {}),
        ...buildHomeRouteQuery(
          currentViewMode.value,
          filterCondition.value,
          currentFolderFilter.value,
          folderCollectionPath.value,
        ),
      };

      const currentComparable = getComparableHomeQuery(route.query);
      const nextComparable = getComparableHomeQuery(nextQuery);
      if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) {
        return;
      }

      void router.replace({
        path: '/',
        query: nextQuery,
      });
    },
    { immediate: true },
  );
}
