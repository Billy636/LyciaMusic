<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { AlertTriangle, FileAudio, Info, Trash2 } from 'lucide-vue-next';
import type { DuplicateSong } from '../../features/duplicates/types';

const props = defineProps<{
  visible: boolean;
  songs: DuplicateSong[];
  hiddenCount: number;
}>();
const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const acknowledged = ref(false);
const finishing = ref(false);
const titleId = useId();
const warningId = useId();
const responsibilityId = useId();
const acknowledgementId = useId();
const listHeadingId = useId();
let returnFocus: HTMLElement | null = null;
let focusRequest = 0;

const finiteBytes = (bytes: number) => Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
const totalBytes = computed(() => props.songs.reduce((total, song) => total + finiteBytes(song.file_size), 0));
const canConfirm = computed(() => acknowledged.value && props.songs.length > 0 && !finishing.value);
const formatBytes = (value: number) => {
  const bytes = finiteBytes(value);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

function restoreFocus() {
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

function cancel() {
  if (!props.visible || finishing.value) return;
  finishing.value = true;
  emit('cancel');
}

function confirm() {
  if (!props.visible || !canConfirm.value) return;
  finishing.value = true;
  emit('confirm');
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  '[contenteditable="true"]',
].join(',');

function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) return;
  // Capture before the player's window-level keyboard shortcuts can run.
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
    return;
  }
  // This destructive dialog never treats Enter as implicit confirmation.
  if (event.key === 'Enter') {
    event.preventDefault();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = Array.from(dialog.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
    .filter(element => !element.hidden && !element.closest('[inert]') && element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.value?.focus({ preventScroll: true });
    return;
  }
  const active = document.activeElement;
  if (!focusable.includes(active as HTMLElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleKeyup(event: KeyboardEvent) {
  if (props.visible) event.stopPropagation();
}

watch(() => props.visible, async visible => {
  const request = ++focusRequest;
  acknowledged.value = false;
  finishing.value = false;
  if (visible) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !dialog.value?.contains(active)) returnFocus = active;
    await nextTick();
    if (props.visible && request === focusRequest) cancelButton.value?.focus({ preventScroll: true });
  } else {
    await nextTick();
    if (!props.visible && request === focusRequest) restoreFocus();
  }
}, { immediate: true });

// Any replacement of the parent's frozen selection requires a new acknowledgement.
watch(() => props.songs, () => { acknowledged.value = false; });

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('keyup', handleKeyup, true);
});
onBeforeUnmount(() => {
  focusRequest += 1;
  window.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('keyup', handleKeyup, true);
  restoreFocus();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="duplicate-delete-modal">
      <div v-if="visible" class="delete-dialog-overlay" @click.self="cancel">
        <section
          ref="dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="`${warningId} ${responsibilityId}`"
          tabindex="-1"
          class="delete-dialog text-gray-800 dark:text-gray-100"
        >
          <header class="dialog-header">
            <span class="dialog-icon"><Trash2 :size="22" :stroke-width="1.8" aria-hidden="true" /></span>
            <div>
              <h2 :id="titleId">确认永久删除所选音频？</h2>
              <p class="app-text-secondary">请先核对清单，再决定是否继续。</p>
            </div>
          </header>

          <div class="dialog-body">
            <div class="danger-notice">
              <AlertTriangle :size="20" aria-hidden="true" />
              <div>
                <p :id="warningId" class="danger-title">永久删除，不会进入回收站，无法撤销。</p>
                <p :id="responsibilityId">请逐项核对文件与保留版本，并自行备份。因用户选择或误删造成的数据丢失，本软件不承担责任。</p>
              </div>
            </div>

            <div class="selection-heading">
              <h3 :id="listHeadingId">待删除文件 <span>{{ songs.length }} 个</span></h3>
              <span class="selection-size app-text-secondary">共 {{ formatBytes(totalBytes) }}</span>
            </div>
            <p v-if="hiddenCount > 0" class="hidden-warning">
              <Info :size="16" aria-hidden="true" />
              <span>包含 {{ hiddenCount }} 个被当前搜索条件隐藏的已选文件，均已列在下方。</span>
            </p>
            <ol class="file-list custom-scrollbar" :aria-labelledby="listHeadingId" tabindex="0">
              <li v-for="song in songs" :key="song.path" class="file-item">
                <FileAudio :size="18" class="file-icon app-text-secondary" aria-hidden="true" />
                <div class="file-copy">
                  <div class="file-heading"><span class="file-name">{{ song.name }}</span><span class="file-size app-text-secondary">{{ formatBytes(song.file_size) }}</span></div>
                  <p class="file-path app-text-secondary">{{ song.path }}</p>
                </div>
              </li>
              <li v-if="!songs.length" class="empty-list app-text-secondary">当前没有待删除文件。</li>
            </ol>
            <p class="operation-note app-text-secondary">仅删除勾选的音频文件，歌词、CUE 等配套文件不会删除；每个重复组至少保留一个版本。</p>

            <div class="risk-acknowledgement" :class="{ acknowledged }">
              <input :id="acknowledgementId" v-model="acknowledged" type="checkbox" :disabled="finishing || !songs.length" />
              <label :for="acknowledgementId">我已仔细检查所选文件，了解永久删除风险并自行承担后果</label>
            </div>
          </div>

          <footer class="dialog-actions">
            <button ref="cancelButton" type="button" class="cancel-button" :disabled="finishing" @click="cancel">取消</button>
            <button type="button" class="delete-button" :disabled="!canConfirm" @click="confirm"><Trash2 :size="16" aria-hidden="true" />永久删除 {{ songs.length }} 个文件</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.delete-dialog-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(0 0 0 / .4); backdrop-filter: blur(7px); }
.delete-dialog { display: flex; flex-direction: column; width: 100%; max-width: 640px; max-height: calc(100dvh - 32px); border: 1px solid rgb(255 255 255 / .5); border-radius: 18px; background: rgb(255 255 255 / .93); box-shadow: 0 24px 80px rgb(0 0 0 / .22); backdrop-filter: blur(24px); overflow: hidden; outline: none; font-size: 14px; line-height: 1.6; }
.dialog-header { display: flex; align-items: center; gap: 13px; padding: 23px 24px 18px; flex-shrink: 0; }
.dialog-icon { display: grid; place-items: center; width: 43px; height: 43px; flex-shrink: 0; border-radius: 12px; background: rgb(236 65 65 / .1); color: #c93232; }
.dialog-header h2 { font-size: 18px; font-weight: 600; line-height: 1.5; }
.dialog-header p { margin-top: 3px; font-size: 14px; }
.dialog-body { min-height: 0; overflow-y: auto; padding: 0 24px 22px; }
.danger-notice { display: flex; align-items: flex-start; gap: 10px; padding: 14px 15px; border: 1px solid rgb(236 65 65 / .22); border-radius: 10px; background: rgb(236 65 65 / .065); color: #ad2e2e; }
.danger-notice > svg { flex-shrink: 0; margin-top: 2px; }
.danger-title { font-weight: 650; margin-bottom: 6px; }
.selection-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 16px; margin: 20px 0 10px; }
.selection-heading h3 { font-size: 14px; font-weight: 600; }
.selection-heading h3 span { margin-left: 5px; color: #c93232; }
.selection-size { font-variant-numeric: tabular-nums; }
.hidden-warning { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 10px; color: #9b631e; }
.hidden-warning svg { flex-shrink: 0; margin-top: 3px; }
.file-list { max-height: min(29dvh, 260px); overflow-y: auto; overscroll-behavior: contain; border: 1px solid rgb(128 128 128 / .18); border-radius: 10px; background: rgb(255 255 255 / .45); list-style: none; padding: 0; margin: 0; }
.file-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 13px; }
.file-item + .file-item { border-top: 1px solid rgb(128 128 128 / .13); }
.file-icon { flex-shrink: 0; margin-top: 2px; }
.file-copy { min-width: 0; flex: 1; }
.file-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 12px; }
.file-name { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; user-select: text; }
.file-size { flex-shrink: 0; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.file-path { margin-top: 4px; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; user-select: text; }
.empty-list { padding: 20px 14px; text-align: center; }
.operation-note { margin-top: 11px; font-size: 14px; }
.risk-acknowledgement { display: flex; align-items: flex-start; gap: 10px; margin-top: 19px; padding: 13px 14px; border: 1px solid rgb(128 128 128 / .18); border-radius: 10px; background: rgb(0 0 0 / .025); transition: border-color .15s, background .15s; }
.risk-acknowledgement.acknowledged { border-color: rgb(236 65 65 / .3); background: rgb(236 65 65 / .045); }
.risk-acknowledgement input { width: 18px; height: 18px; flex-shrink: 0; margin-top: 3px; accent-color: #d93434; cursor: pointer; }
.risk-acknowledgement label { cursor: pointer; }
.risk-acknowledgement:has(input:disabled) label { cursor: not-allowed; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; flex-shrink: 0; border-top: 1px solid rgb(128 128 128 / .12); background: rgb(247 247 247 / .65); }
.dialog-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; border: 1px solid transparent; border-radius: 9px; padding: 8px 17px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background .15s, opacity .15s; }
.cancel-button { min-width: 88px; border-color: rgb(128 128 128 / .23) !important; background: rgb(255 255 255 / .75); }
.cancel-button:hover:not(:disabled) { background: white; }
.delete-button { background: #d93434; color: white; }
.delete-button:hover:not(:disabled) { background: #bf2929; }
.dialog-actions button:disabled { cursor: not-allowed; opacity: .42; }
button:focus-visible, input:focus-visible, .file-list:focus-visible { outline: 2px solid rgb(217 52 52 / .65); outline-offset: 3px; }
.dark .delete-dialog { background: rgb(29 30 35 / .96); border-color: rgb(255 255 255 / .1); }
.dark .dialog-icon { background: rgb(236 65 65 / .13); color: #ffaaaa; }
.dark .danger-notice { background: rgb(236 65 65 / .09); border-color: rgb(236 65 65 / .28); color: #ffaaaa; }
.dark .selection-heading h3 span { color: #ffaaaa; }
.dark .hidden-warning { color: #e9bc79; }
.dark .file-list { background: rgb(255 255 255 / .025); border-color: rgb(255 255 255 / .12); }
.dark .file-item + .file-item { border-color: rgb(255 255 255 / .09); }
.dark .risk-acknowledgement { background: rgb(255 255 255 / .035); border-color: rgb(255 255 255 / .14); }
.dark .risk-acknowledgement.acknowledged { background: rgb(236 65 65 / .08); border-color: rgb(236 65 65 / .4); }
.dark .dialog-actions { background: rgb(255 255 255 / .025); border-color: rgb(255 255 255 / .09); }
.dark .cancel-button { background: rgb(255 255 255 / .055); border-color: rgb(255 255 255 / .18) !important; }
.dark .cancel-button:hover:not(:disabled) { background: rgb(255 255 255 / .09); }
.duplicate-delete-modal-enter-active, .duplicate-delete-modal-leave-active { transition: opacity .16s ease; }
.duplicate-delete-modal-enter-active .delete-dialog, .duplicate-delete-modal-leave-active .delete-dialog { transition: transform .16s ease; }
.duplicate-delete-modal-enter-from, .duplicate-delete-modal-leave-to { opacity: 0; }
.duplicate-delete-modal-enter-from .delete-dialog, .duplicate-delete-modal-leave-to .delete-dialog { transform: translateY(6px) scale(.985); }
.duplicate-delete-modal-leave-active { pointer-events: none; }
@media (max-width: 480px) {
  .delete-dialog-overlay { padding: 10px; }
  .delete-dialog { max-height: calc(100dvh - 20px); }
  .dialog-header { padding: 18px 16px 15px; }
  .dialog-body { padding: 0 16px 18px; }
  .dialog-actions { padding: 14px 16px; gap: 9px; }
  .dialog-actions button { padding: 8px 12px; }
  .cancel-button { min-width: 70px; }
}
@media (prefers-reduced-motion: reduce) {
  .duplicate-delete-modal-enter-active, .duplicate-delete-modal-leave-active,
  .duplicate-delete-modal-enter-active .delete-dialog, .duplicate-delete-modal-leave-active .delete-dialog,
  .risk-acknowledgement, .dialog-actions button { transition: none; }
}
</style>
