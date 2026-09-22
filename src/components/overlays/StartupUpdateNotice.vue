<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { startStartupUpdateCheck, useStartupUpdateNotice } from '../../composables/useUpdateCheck';
import { useSettings } from '../../features/settings/useSettings';
import ModernModal from '../common/ModernModal.vue';

const { settings } = useSettings();
const { startupUpdate, dismissStartupUpdate } = useStartupUpdateNotice();
const openError = ref(false);
let dispose = () => {};

const visible = computed({
  get: () => startupUpdate.value !== null && settings.value.autoCheckUpdatesOnStartup,
  set: value => { if (!value) dismissStartupUpdate(); },
});
const content = computed(() => {
  const update = startupUpdate.value;
  if (!update) return '';
  const notes = update.release.notes?.trim();
  return `当前版本：v${update.currentVersion}；最新版本：v${update.release.version}。`
    + (notes ? ` 更新说明：${notes}` : '')
    + ' 是否前往下载？不会自动安装更新。';
});

async function openRelease() {
  const url = startupUpdate.value?.release.url;
  dismissStartupUpdate();
  if (!url) return;
  try {
    await openUrl(url);
  } catch (error) {
    console.warn('Failed to open update page:', error);
    openError.value = true;
  }
}

watch(() => settings.value.autoCheckUpdatesOnStartup, enabled => {
  if (!enabled) dismissStartupUpdate();
});
onMounted(() => { dispose = startStartupUpdateCheck(() => settings.value.autoCheckUpdatesOnStartup); });
onUnmounted(() => dispose());
</script>

<template>
  <ModernModal
    v-model:visible="visible"
    title="发现新版本"
    :content="content"
    confirm-text="前往更新"
    cancel-text="稍后"
    @confirm="openRelease"
  />
  <ModernModal
    v-model:visible="openError"
    title="无法打开下载页面"
    content="请前往设置中的「关于」页面重试检查更新，或通过官方网站下载。"
    confirm-text="知道了"
    cancel-text="关闭"
  />
</template>
