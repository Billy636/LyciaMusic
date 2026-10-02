import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { buildDefaultHomeLocation } from '../composables/useHomeNavigation';
import { useSettings } from '../features/settings/useSettings';

// 使用路由懒加载优化首屏加载速度
const Home = () => import('../views/Home.vue');
const Favorites = () => import('../views/Favorites.vue');
const Recent = () => import('../views/Recent.vue');
const Artists = () => import('../views/Artists.vue');
const Albums = () => import('../views/Albums.vue');
const Playlists = () => import('../views/Playlists.vue');
const Settings = () => import('../views/Settings.vue');

const routes: Array<RouteRecordRaw> = [
  { path: '/', name: 'Home', component: Home, meta: { keepAlive: true } },
  { path: '/favorites', name: 'Favorites', component: Favorites },
  { path: '/recent', name: 'Recent', component: Recent },
  { path: '/artists', name: 'Artists', component: Artists },
  { path: '/albums', name: 'Albums', component: Albums },
  { path: '/playlists', name: 'Playlists', component: Playlists },
  { path: '/settings', name: 'Settings', component: Settings },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.path !== '/') return;

  const homeQueryKeys = ['view', 'filter', 'folder', 'collection'];
  const isDefaultHome = !homeQueryKeys.some(key => to.query[key] !== undefined);
  const view = Array.isArray(to.query.view) ? to.query.view[0] : to.query.view;
  if (!isDefaultHome && view !== 'all') return;

  // Read after Pinia is installed, including persisted settings on initial navigation.
  const { sidebar } = useSettings();
  if (!isDefaultHome && sidebar.value.showLocalMusic) return;

  const destination = router.resolve(buildDefaultHomeLocation(sidebar.value));
  // Local music is already rendered at '/', including the all-hidden fallback.
  if (destination.path === '/' && destination.query.view === 'all') return;

  const query = { ...to.query };
  homeQueryKeys.forEach(key => delete query[key]);
  return {
    path: destination.path,
    query: { ...query, ...destination.query },
    hash: to.hash,
    replace: true,
  };
});

export default router;
