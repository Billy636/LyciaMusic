<script setup lang="ts">
import { nextTick, ref, useId, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info';
}>();

const emit = defineEmits(['confirm', 'cancel', 'update:visible']);

const isClosing = ref(false);
const dialogCard = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
const contentId = useId();
let returnFocus: HTMLElement | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const finish = (action: 'confirm' | 'cancel') => {
  if (!props.visible || isClosing.value) return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    emit(action);
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleClose = () => finish('cancel');
const handleConfirm = () => finish('confirm');

watch(() => props.visible, async visible => {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
  isClosing.value = false;
  if (visible) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (props.visible) cancelButton.value?.focus();
  } else {
    await nextTick();
    if (!props.visible && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
}, { immediate: true });

// 默认聚焦取消；让键盘操作留在弹窗内，避免误触底层播放快捷键。
const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    handleClose();
  } else if (e.key === 'Tab') {
    const buttons = dialogCard.value?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialogCard.value?.contains(document.activeElement))) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !dialogCard.value?.contains(document.activeElement))) {
      e.preventDefault();
      first?.focus();
    }
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown, true));
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true);
  if (closeTimer !== null) clearTimeout(closeTimer);
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible" 
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <!-- Backdrop -->
      <div 
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Card -->
      <div 
        ref="dialogCard"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="contentId"
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Header -->
        <div class="px-6 pt-6 pb-2 text-center">
          <div 
            v-if="type === 'danger'"
            class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4"
          >
            <svg class="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 :id="titleId" class="text-lg font-bold text-gray-900 dark:text-white leading-6">{{ title }}</h3>
        </div>

        <!-- Body -->
        <div class="px-6 pb-6 text-center">
          <p :id="contentId" class="text-sm text-gray-500 dark:text-gray-300 leading-relaxed break-words max-h-[40vh] overflow-y-auto">{{ content }}</p>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button 
            @click="handleConfirm" 
            class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-sm transition-all duration-200"
            :class="type === 'danger' ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'"
          >
            {{ confirmText || '确定' }}
          </button>
          <button 
            ref="cancelButton"
            @click="handleClose" 
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            {{ cancelText || '取消' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
