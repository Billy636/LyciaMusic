import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../settings/store';

export const useArtistImages = defineStore('artistImages', () => {
  const settings = useSettingsStore();
  const images = shallowRef<Record<string, string>>({});
  const failedUrls = ref(new Set<string>());
  const loading = ref(false);
  const error = ref('');
  const skipped = ref(0);
  const count = computed(() => Object.keys(images.value).length);
  let request = 0;
  async function refresh() {
    const token = ++request;
    const folder = settings.settings.artistImageFolder;
    images.value = {};
    failedUrls.value.clear();
    error.value = '';
    skipped.value = 0;
    loading.value = !!folder;
    if (!folder) return;
    try {
      const result = await invoke<{ images: Record<string, string>; skipped: number }>('scan_artist_images', { folder });
      if (token !== request) return;
      images.value = result.images;
      skipped.value = result.skipped;
    } catch (cause) {
      if (token === request) error.value = `读取失败：${String(cause)}`;
    } finally {
      if (token === request) loading.value = false;
    }
  }
  function urlFor(name: string) {
    const key = name.trim().toLowerCase();
    const path = Object.prototype.hasOwnProperty.call(images.value, key) ? images.value[key] : '';
    const url = path ? convertFileSrc(path) : '';
    return failedUrls.value.has(url) ? '' : url;
  }
  function markFailed(name: string) {
    const url = urlFor(name);
    if (url) failedUrls.value.add(url);
  }
  watch(() => settings.settings.artistImageFolder, () => { void refresh(); }, { immediate: true });
  return { images, loading, error, skipped, count, refresh, urlFor, markFailed };
});
