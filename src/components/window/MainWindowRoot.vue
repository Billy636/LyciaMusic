<script setup lang="ts">
import '@applemusic-like-lyrics/core/style.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted } from 'vue';

import { useImportedLyricsFonts } from '../../composables/useImportedLyricsFonts';
import { useSettings } from '../../features/settings/useSettings';
import MainShell from '../layout/MainShell.vue';

const appWindow = getCurrentWindow();
const { settings } = useSettings();
let unlistenCloseRequested: (() => void) | null = null;

useImportedLyricsFonts();

onMounted(async () => {
  unlistenCloseRequested = await appWindow.onCloseRequested(async event => {
    if (settings.value.closeToTray) {
      event.preventDefault();
      await appWindow.hide();
    }
  });
});

onUnmounted(() => {
  unlistenCloseRequested?.();
  unlistenCloseRequested = null;
});
</script>

<template>
  <MainShell />
</template>
