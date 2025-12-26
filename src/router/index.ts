import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import SongList from '../components/song-list/SongList.vue'; 
import Artists from '../views/Artists.vue'; 
import Albums from '../views/Albums.vue'; 
import Settings from '../views/Settings.vue'; 

const routes: Array<RouteRecordRaw> = [
  { path: '/', name: 'Home', component: SongList },
  { path: '/favorites', name: 'Favorites', component: SongList },
  { path: '/recent', name: 'Recent', component: SongList },
  { path: '/artists', name: 'Artists', component: Artists },
  { path: '/albums', name: 'Albums', component: Albums },
  { path: '/settings', name: 'Settings', component: Settings },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;