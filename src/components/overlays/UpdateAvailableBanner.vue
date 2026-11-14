<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ignoreStartupUpdateVersion } from '../../composables/useUpdateCheck';
import { getUpdatePageLinks, type ReleaseInfo } from '../../utils/update';

const props = defineProps<{
  visible: boolean;
  release: ReleaseInfo | null;
}>();
const emit = defineEmits<{ 'update:visible': [visible: boolean] }>();
const opening = ref(false);
const errorMessage = ref('');
const pointerInside = ref(false);
const focusInside = ref(false);
let interactionId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function clearDismissTimer() {
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = null;
}

function handleFocusOut(event: FocusEvent) {
  focusInside.value = event.currentTarget instanceof Node
    && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
}

function dismiss() {
  interactionId += 1;
  opening.value = false;
  emit('update:visible', false);
}

async function viewUpdate() {
  if (!props.release || opening.value) return;
  const url = getUpdatePageLinks(props.release).official;
  const requestId = ++interactionId;
  opening.value = true;
  errorMessage.value = '';
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
    if (props.visible && requestId === interactionId) dismiss();
  } catch (error) {
    console.warn('Failed to open official update page:', error);
    if (props.visible && requestId === interactionId) errorMessage.value = '无法打开官网，请稍后重试。';
  } finally {
    if (requestId === interactionId) opening.value = false;
  }
}

function ignoreVersion() {
  if (!props.release || opening.value) return;
  if (ignoreStartupUpdateVersion(props.release.version)) dismiss();
  else errorMessage.value = '无法保存忽略设置，请重试。';
}

watch(() => [props.visible, props.release?.version], () => {
  interactionId += 1;
  opening.value = false;
  errorMessage.value = '';
  pointerInside.value = false;
  focusInside.value = false;
});
watch([() => props.visible, () => props.release?.version, opening, errorMessage, pointerInside, focusInside], () => {
  clearDismissTimer();
  if (props.visible && props.release && !opening.value && !errorMessage.value
    && !pointerInside.value && !focusInside.value) {
    dismissTimer = setTimeout(dismiss, 10_000);
  }
}, { immediate: true });
onUnmounted(() => {
  interactionId += 1;
  clearDismissTimer();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="update-banner" appear>
      <section v-if="visible && release" class="update-banner" aria-label="版本更新提醒"
        @pointerenter="pointerInside = true" @pointerleave="pointerInside = false"
        @focusin="focusInside = true" @focusout="handleFocusOut">
        <div class="update-banner__row">
          <div class="update-banner__copy" role="status" aria-live="polite">
            <p class="update-banner__title">发现新版本 <span class="update-banner__version">v{{ release.version }}</span></p>
          </div>
          <div class="update-banner__actions">
            <button type="button" class="update-banner__ignore" :disabled="opening"
              title="忽略此版本，后续新版本仍会提醒" @click="ignoreVersion">忽略</button>
            <button type="button" class="update-banner__view" :disabled="opening" @click="viewUpdate">
              {{ opening ? '打开中' : '查看' }}
            </button>
          </div>
        </div>
        <p v-if="errorMessage" class="update-banner__error" role="alert">{{ errorMessage }}</p>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-banner {
  --banner-surface: rgba(255, 255, 255, 0.97);
  --banner-border: rgba(15, 23, 42, 0.08);
  --banner-text: #1f2937;
  --banner-muted: #64748b;
  --banner-hover: rgba(15, 23, 42, 0.05);
  position: fixed;
  z-index: 9000;
  top: 76px;
  left: 16px;
  box-sizing: border-box;
  width: max-content;
  max-width: min(200px, calc(100vw - 32px));
  padding: 8px 10px;
  border: 1px solid var(--banner-border);
  border-left: 3px solid #ec4141;
  border-radius: 10px;
  background: var(--banner-surface);
  color: var(--banner-text);
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.04);
  backdrop-filter: blur(16px);
  -webkit-app-region: no-drag;
}
:global(html.dark .update-banner) {
  --banner-surface: rgba(31, 33, 39, 0.97);
  --banner-border: rgba(255, 255, 255, 0.1);
  --banner-text: #f3f4f6;
  --banner-muted: #aeb4c0;
  --banner-hover: rgba(255, 255, 255, 0.07);
}
.update-banner__row { display: flex; flex-direction: column; gap: 4px; }
.update-banner__copy { min-width: 0; }
.update-banner__title { margin: 0; font-size: 13px; font-weight: 650; line-height: 20px; }
.update-banner__version { margin-left: 5px; overflow-wrap: anywhere; }
.update-banner__actions { display: flex; align-items: center; justify-content: flex-start; gap: 10px; }
.update-banner__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  min-width: 48px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 150ms, box-shadow 150ms;
}
.update-banner__actions button:disabled { opacity: 0.6; cursor: wait; }
.update-banner__actions button:focus-visible { box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.3); }
.update-banner__view { background: #ec4141; color: #fff; }
.update-banner__view:hover:not(:disabled) { background: #d63838; }
.update-banner__ignore { background: transparent; color: var(--banner-muted); }
.update-banner__ignore:hover:not(:disabled) { background: var(--banner-hover); color: var(--banner-text); }
.update-banner__error { margin: 8px 0 0; color: #ec4141; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.update-banner-enter-active { transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms; }
.update-banner-leave-active { transition: transform 220ms ease-in, opacity 180ms; }
.update-banner-enter-from,
.update-banner-leave-to { transform: translateX(calc(-100% - 24px)); opacity: 0; }
@media (max-width: 380px) {
  .update-banner { left: 12px; max-width: min(200px, calc(100vw - 24px)); }
}
@media (pointer: coarse) {
  .update-banner__actions button { min-height: 44px; min-width: 52px; }
}
@media (prefers-reduced-motion: reduce) {
  .update-banner-enter-active,
  .update-banner-leave-active { transition: none; }
}
</style>
