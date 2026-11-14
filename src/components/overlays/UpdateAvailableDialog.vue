<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ignoreStartupUpdateVersion } from '../../composables/useUpdateCheck';
import { getUpdatePageLinks, type ReleaseInfo } from '../../utils/update';

const props = defineProps<{
  visible: boolean;
  currentVersion: string;
  release: ReleaseInfo | null;
}>();
const emit = defineEmits<{ 'update:visible': [visible: boolean] }>();
const titleId = useId();
const versionId = useId();
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const opening = ref(false);
const errorMessage = ref('');
const links = computed(() => props.release ? getUpdatePageLinks(props.release) : null);
let returnFocus: HTMLElement | null = null;
let interactionId = 0;

function close() {
  interactionId += 1;
  emit('update:visible', false);
}

async function openPage(target: 'official' | 'github' | 'announcement') {
  const url = links.value?.[target];
  if (!url || opening.value) return;
  const requestId = ++interactionId;
  opening.value = true;
  errorMessage.value = '';
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
    if (props.visible && requestId === interactionId && target !== 'announcement') close();
  } catch (error) {
    console.warn('Failed to open update page:', error);
    if (props.visible && requestId === interactionId) errorMessage.value = '无法打开页面，请稍后重试。';
  } finally {
    if (requestId === interactionId) opening.value = false;
  }
}

function ignoreVersion() {
  if (!props.release || opening.value) return;
  if (ignoreStartupUpdateVersion(props.release.version)) close();
  else errorMessage.value = '无法保存忽略设置，请重试。';
}

watch(() => props.visible, async visible => {
  interactionId += 1;
  opening.value = false;
  errorMessage.value = '';
  if (visible) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (props.visible) closeButton.value?.focus();
  } else {
    const focusToRestore = returnFocus;
    returnFocus = null;
    await nextTick();
    if (!props.visible && focusToRestore?.isConnected) focusToRestore.focus();
  }
}, { immediate: true });

function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) return;
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'Tab') {
    const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const outside = !Array.from(buttons).some(button => button === document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault();
      first?.focus();
    }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true));
onUnmounted(() => {
  interactionId += 1;
  window.removeEventListener('keydown', handleKeydown, true);
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && release" class="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" @click="close"></div>
      <section ref="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="versionId"
        class="relative w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-6 shadow-2xl backdrop-blur-md dark:bg-gray-900/95">
        <button ref="closeButton" type="button" aria-label="稍后提醒" @click="close"
          class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/5 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-gray-200">
          <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
        <h3 :id="titleId" class="pr-6 text-lg font-bold text-gray-900 dark:text-white">发现新版本</h3>
        <p :id="versionId" class="mt-2 text-sm text-gray-500 dark:text-gray-300">
          <span class="whitespace-nowrap">v{{ currentVersion }}</span>
          <span class="mx-2" aria-hidden="true">→</span><span class="sr-only">更新至</span>
          <span class="whitespace-nowrap font-medium text-gray-800 dark:text-gray-100">v{{ release.version }}</span>
        </p>
        <div class="mt-6 grid grid-cols-2 gap-3">
          <button type="button" :disabled="opening" @click="openPage('official')"
            class="rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50">
            官网下载
          </button>
          <button type="button" :disabled="opening" @click="openPage('github')"
            class="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
            GitHub 下载
          </button>
        </div>
        <div class="mt-4 flex items-center justify-between gap-3 text-sm">
          <button type="button" :disabled="opening" @click="openPage('announcement')"
            class="rounded text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-blue-400">查看公告</button>
          <button type="button" :disabled="opening" @click="ignoreVersion"
            class="rounded text-gray-500 transition hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200">不再提示此版本</button>
        </div>
        <p v-if="errorMessage" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</p>
      </section>
    </div>
  </Teleport>
</template>
