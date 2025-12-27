<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps<{
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits(['confirm', 'cancel', 'update:visible']);

const inputValue = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const isClosing = ref(false);

watch(() => props.visible, async (val) => {
  if (val) {
    inputValue.value = props.initialValue || '';
    await nextTick();
    if (inputRef.value) inputRef.value.focus();
  }
});

const handleClose = () => {
  isClosing.value = true;
  setTimeout(() => {
    emit('cancel');
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleConfirm = () => {
  if (!inputValue.value.trim()) return;
  
  isClosing.value = true;
  setTimeout(() => {
    emit('confirm', inputValue.value.trim());
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
  if (e.key === 'Enter' && props.visible) {
    handleConfirm();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible" 
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{'pointer-events-none': isClosing}"
    >
      <!-- Backdrop -->
      <div 
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Card -->
      <div 
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Header -->
        <div class="px-6 pt-6 pb-2 text-center">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-6">{{ title }}</h3>
        </div>

        <!-- Body -->
        <div class="px-6 pb-6">
          <input
            ref="inputRef"
            v-model="inputValue"
            type="text"
            :placeholder="placeholder"
            class="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button 
            @click="handleConfirm" 
            :disabled="!inputValue.trim()"
            class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ confirmText || '确定' }}
          </button>
          <button 
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