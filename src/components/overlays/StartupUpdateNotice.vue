<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { startStartupUpdateCheck, useStartupUpdateNotice } from '../../composables/useUpdateCheck';
import { useSettings } from '../../features/settings/useSettings';
import UpdateAvailableDialog from './UpdateAvailableDialog.vue';

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
  <UpdateAvailableDialog
    v-model:visible="visible"
    :current-version="startupUpdate?.currentVersion ?? ''"
    :release="startupUpdate?.release ?? null"
  />
</template>
