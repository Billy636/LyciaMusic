import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

// 使用路由懒加载优化首屏加载速度
const Home = () => import('../views/Home.vue');
const Favorites = () => import('../views/Favorites.vue');
const Recent = () => import('../views/Recent.vue');
const Artists = () => import('../views/Artists.vue'); 
const Albums = () => import('../views/Albums.vue'); 
const Settings = () => import('../views/Settings.vue'); 

const routes: Array<RouteRecordRaw> = [
  { path: '/', name: 'Home', component: Home },
  { path: '/favorites', name: 'Favorites', component: Favorites },
  { path: '/recent', name: 'Recent', component: Recent },
  { path: '/artists', name: 'Artists', component: Artists },
  { path: '/albums', name: 'Albums', component: Albums },
  { path: '/settings', name: 'Settings', component: Settings },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;