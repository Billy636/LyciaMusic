<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

export interface RenamePreview {
  original_path: string;
  original_name: string;
  new_name: string;
  status: string;
  error?: string;
}

const props = defineProps<{
  visible: boolean;
  items: RenamePreview[];
}>();

const emit = defineEmits(['confirm', 'cancel', 'update:visible']);

const isClosing = ref(false);

const handleClose = () => {
  isClosing.value = true;
  setTimeout(() => {
    emit('cancel');
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleConfirm = () => {
  const validItems = props.items.filter(i => i.status !== 'skipped' && !i.error);
  if (validItems.length === 0) {
      handleClose();
      return;
  }
  isClosing.value = true;
  setTimeout(() => {
    emit('confirm', validItems);
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

const validCount = computed(() => props.items.filter(i => i.status !== 'skipped' && !i.error).length);
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible" 
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{'pointer-events-none': isClosing}"
    >
      <div 
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <div 
        class="relative bg-white/95 dark:bg-[#2b2b2b] backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden transform transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Header -->
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">预览修改</h3>
          <span class="text-sm text-gray-500 dark:text-gray-400">即将修改 {{ validCount }} 个文件</span>
        </div>

        <!-- Table -->
        <div class="flex-1 overflow-y-auto p-0 custom-scrollbar">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 dark:bg-white/5 sticky top-0 z-10 text-gray-500 dark:text-gray-400 font-medium">
                    <tr>
                        <th class="px-6 py-3 w-16 text-center">状态</th>
                        <th class="px-6 py-3 w-[40%]">原文件名</th>
                        <th class="px-6 py-3 w-8"></th>
                        <th class="px-6 py-3 w-[40%]">新文件名</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-white/5">
                    <tr v-for="item in items" :key="item.original_path" class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                        <td class="px-6 py-3 text-center">
                            <span v-if="item.status === 'tags'" title="基于标签" class="text-green-500">✨</span>
                            <span v-else-if="item.status === 'rules'" title="基于规则" class="text-yellow-500">✂️</span>
                            <span v-else title="跳过" class="text-gray-300 dark:text-gray-600">⚠️</span>
                        </td>
                        <td class="px-6 py-3 text-gray-600 dark:text-gray-300 truncate max-w-xs" :title="item.original_name">{{ item.original_name }}</td>
                        <td class="px-6 py-3 text-gray-400">→</td>
                        <td class="px-6 py-3 font-medium truncate max-w-xs" 
                            :class="item.status === 'skipped' ? 'text-gray-400 dark:text-gray-600' : 'text-gray-900 dark:text-white'"
                            :title="item.new_name"
                        >
                            {{ item.new_name }}
                            <span v-if="item.error" class="text-xs text-red-500 ml-2">({{ item.error }})</span>
                        </td>
                    </tr>
                    <tr v-if="items.length === 0">
                        <td colspan="4" class="px-6 py-8 text-center text-gray-500">没有发现可修改的文件</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 bg-gray-50/50 dark:bg-white/5 flex gap-3 justify-end border-t border-gray-200 dark:border-white/10">
          <button 
            @click="handleClose" 
            class="px-5 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-transparent text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition font-medium text-sm"
          >
            取消
          </button>
          <button 
            @click="handleConfirm" 
            :disabled="validCount === 0"
            class="px-5 py-2.5 rounded-xl bg-[#EC4141] text-white hover:bg-[#d13a3a] transition font-bold text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用修改 ({{ validCount }})
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
