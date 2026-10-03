<script setup lang="ts">
import { nextTick, onDeactivated, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../features/settings/store';
import { useArtistImages } from '../../features/library/artistImages';

const props = defineProps<{ otherMenuOpen: boolean }>();
const emit = defineEmits<{ open: [] }>();
const settingsStore = useSettingsStore();
const artistImages = useArtistImages();
const visible = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const id = useId();
const close = () => { visible.value = false; };
function closeAndFocus() { close(); trigger.value?.focus({ preventScroll: true }); }
async function toggle() {
  if (visible.value) { close(); return; }
  if (!trigger.value) return;
  emit('open');
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  panelStyle.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: `${rect.bottom + 8}px`,
    maxHeight: `${Math.max(0, window.innerHeight - rect.bottom - 16)}px`,
  };
  visible.value = true;
  await nextTick();
  panel.value?.focus({ preventScroll: true });
}
async function selectFolder() {
  try {
    const selected = await open({ directory: true, multiple: false, title: '选择歌手头像文件夹' });
    if (typeof selected === 'string') {
      if (selected === settingsStore.settings.artistImageFolder) await artistImages.refresh();
      else settingsStore.settings.artistImageFolder = selected;
    }
  } catch (error) {
    artistImages.error = `无法选择文件夹：${String(error)}`;
  }
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !panel.value?.contains(target)) close();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAndFocus(); }
}
function focusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (next && !panel.value?.contains(next) && !trigger.value?.contains(next)) close();
}
watch(() => props.otherMenuOpen, value => { if (value) close(); });
onDeactivated(close);
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', close);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('resize', close);
});
</script>

<template>
  <button ref="trigger" type="button" title="本地歌手头像" aria-label="本地歌手头像"
    aria-haspopup="dialog" :aria-expanded="visible" :aria-controls="`${id}-panel`"
    class="artist-image-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
    :class="{ 'text-[#EC4141] dark:text-[#EC4141]': !!settingsStore.settings.artistImageFolder }"
    @click.stop="toggle" @keydown.esc.stop.prevent="closeAndFocus">
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
      <circle cx="12" cy="11.5" r="2" /><path d="M8.5 18v-1a3.5 3.5 0 0 1 7 0v1" />
    </svg>
  </button>
  <Teleport to="body">
    <section v-if="visible" :id="`${id}-panel`" ref="panel" tabindex="-1" role="dialog"
      :aria-labelledby="`${id}-heading`" :style="panelStyle" @click.stop @keydown="keydown" @focusout="focusout"
      class="artist-image-panel fixed z-[9999] overflow-y-auto rounded-xl border border-gray-100 dark:border-white/10 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md shadow-xl p-4 text-gray-700 dark:text-gray-200">
      <div class="flex items-center justify-between gap-3 mb-2">
        <h3 :id="`${id}-heading`" class="text-sm font-semibold">本地歌手头像</h3>
        <button type="button" aria-label="关闭头像面板" class="rounded p-1 text-gray-400 hover:bg-black/5 dark:hover:bg-white/10" @click="closeAndFocus">
          <svg class="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
      </div>
      <p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">选择存放“歌手名.jpg”的文件夹（如 .artist）。支持 JPG、JPEG、PNG、WebP，仅读取当前层级。</p>
      <p class="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">文件名与歌手名一致，忽略大小写和首尾空格。手动头像优先，未匹配时使用歌曲封面。</p>
      <div v-if="settingsStore.settings.artistImageFolder" class="mt-3 rounded-lg bg-black/5 dark:bg-white/5 px-3 py-2 text-xs break-all" :title="settingsStore.settings.artistImageFolder">{{ settingsStore.settings.artistImageFolder }}</div>
      <div aria-live="polite" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        <span v-if="artistImages.loading">正在读取头像…</span>
        <span v-else-if="artistImages.error" class="text-red-500">{{ artistImages.error }}</span>
        <span v-else-if="settingsStore.settings.artistImageFolder">已读取 {{ artistImages.count }} 个头像<span v-if="artistImages.skipped">，跳过 {{ artistImages.skipped }} 个重复或无效图片</span>。</span>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" class="rounded-lg px-3 py-2 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 disabled:opacity-40" :disabled="artistImages.loading" @click="selectFolder">{{ settingsStore.settings.artistImageFolder ? '更换文件夹' : '选择文件夹' }}</button>
        <button v-if="settingsStore.settings.artistImageFolder" type="button" class="rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="artistImages.loading" @click="artistImages.refresh()">重新读取</button>
        <button v-if="settingsStore.settings.artistImageFolder" type="button" class="rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10" @click="settingsStore.settings.artistImageFolder = ''">取消使用</button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.artist-image-trigger:focus-visible, .artist-image-panel button:focus-visible { box-shadow: 0 0 0 2px #ec414180; }
</style>
