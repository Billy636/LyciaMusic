import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { readFixture } from './fixtures';
import '../../src/style.css';
import '@applemusic-like-lyrics/core/style.css';

mockWindows('main');
const { usePlaybackStore } = await import('../../src/features/playback/store');
mockIPC((command) => {
  if (command === 'get_song_lyrics_source') return readFixture();
  if (command === 'get_system_fonts' || command === 'list_system_fonts'
    || command.startsWith('get_library_')) return [];
  if (command === 'play_audio') return 1;
  if (command === 'get_playback_progress') return usePlaybackStore().currentTime;
  return null;
}, { shouldMockEvents: true });

const { default: App } = await import('./App.vue');
const app = createApp(App);
app.use(createPinia());
app.config.errorHandler = (error) => {
  console.error(error);
  document.querySelector('#error')?.append(document.createTextNode(String(error)));
};
app.mount('#app');
