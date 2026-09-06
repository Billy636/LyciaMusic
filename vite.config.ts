import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), wasm(), topLevelAwait()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep shared runtime dependencies (especially Vue) outside the heavy
        // AMLL/Pixi chunks so lightweight auxiliary windows do not load them.
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (
            normalizedId.includes('/node_modules/vue/')
            || normalizedId.includes('/node_modules/@vue/')
          ) {
            return 'vendor-vue';
          }
          if (normalizedId.includes('/node_modules/@applemusic-like-lyrics/')) {
            return 'vendor-amll';
          }
          if (normalizedId.includes('/node_modules/@pixi/')) {
            return 'vendor-pixi';
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
