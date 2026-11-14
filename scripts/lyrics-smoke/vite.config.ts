import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Separate dependency cache and port: coexist with the app and test runner.
export default defineConfig({
  plugins: [vue()],
  cacheDir: 'node_modules/.vite-lyrics-smoke',
  optimizeDeps: {
    include: ['vue', 'pinia', '@applemusic-like-lyrics/core', '@applemusic-like-lyrics/lyric', '@applemusic-like-lyrics/ttml'],
  },
  server: { host: '127.0.0.1', port: 15430, strictPort: true },
  clearScreen: false,
});
