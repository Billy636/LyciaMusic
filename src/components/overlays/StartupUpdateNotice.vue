<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { startStartupUpdateCheck, useStartupUpdateNotice } from '../../composables/useUpdateCheck';
import { useSettings } from '../../features/settings/useSettings';
import UpdateAvailableBanner from './UpdateAvailableBanner.vue';

const { settings } = useSettings();
const { startupUpdate, dismissStartupUpdate } = useStartupUpdateNotice();
let dispose = () => {};

const visible = computed({
  get: () => startupUpdate.value !== null && settings.value.autoCheckUpdatesOnStartup,
  set: value => { if (!value) dismissStartupUpdate(); },
});

watch(() => settings.value.autoCheckUpdatesOnStartup, enabled => {
  if (!enabled) dismissStartupUpdate();
});
onMounted(() => { dispose = startStartupUpdateCheck(() => settings.value.autoCheckUpdatesOnStartup); });
onUnmounted(() => dispose());
</script>

<template>
  <UpdateAvailableBanner
    v-model:visible="visible"
    :release="startupUpdate?.release ?? null"
  />
</template>
