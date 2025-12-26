<script setup lang="ts">
defineProps<{
  visible: boolean;
  title: string;
  content: string;
}>();

const emit = defineEmits(['confirm', 'cancel']);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] select-none" @click.self="emit('cancel')">
      <div class="bg-white rounded-lg shadow-xl w-80 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        <div class="px-6 pt-6 pb-2 text-center">
          <h3 class="text-lg font-bold text-gray-800">{{ title }}</h3>
        </div>

        <div class="px-6 pb-6 text-center">
          <p class="text-sm text-gray-500 leading-relaxed">{{ content }}</p>
        </div>

        <div class="flex border-t border-gray-100">
          <button 
            @click="emit('cancel')" 
            class="flex-1 py-3 text-sm text-gray-600 hover:bg-gray-50 transition-colors focus:outline-none"
          >
            取消
          </button>
          <div class="w-[1px] bg-gray-100"></div>
          <button 
            @click="emit('confirm')" 
            class="flex-1 py-3 text-sm text-[#EC4141] font-medium hover:bg-red-50 transition-colors focus:outline-none"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>