<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { version as packageVersion } from '../../../package.json';

const appVersion = ref(packageVersion);
onMounted(async () => {
  if (!isTauri()) return;
  try {
    appVersion.value = await getVersion();
  } catch (error) {
    // Browser previews and unavailable IPC keep the build-time version.
    console.warn('Failed to read application version:', error);
  }
});
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 select-none pointer-events-none">
    <img src="/app.png" alt="" draggable="false" class="h-[24px] w-[24px] shrink-0 object-contain" />
    <div class="flex min-w-0 flex-col items-start">
      <span class="brand-wordmark whitespace-nowrap text-[15px] font-medium leading-5 text-gray-700 dark:text-gray-200">
        Lycia Player
      </span>
      <span class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-normal leading-4 text-gray-500 dark:text-gray-400">
        <span class="tabular-nums" :aria-label="`版本 ${appVersion}`">v{{ appVersion }}</span>
        <span class="rounded bg-black/5 px-1 text-[9px] font-medium tracking-wide dark:bg-white/10" aria-label="Early Access，抢先体验版">EA</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.brand-wordmark {
  font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  letter-spacing: 0.015em;
}
</style>
