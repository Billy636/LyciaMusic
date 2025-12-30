<script setup lang="ts">
import { useToast } from '../../composables/toast';

const { toasts } = useToast();
</script>

<template>
  <div class="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
    <transition-group name="toast">
      <div 
        v-for="toast in toasts" 
        :key="toast.id"
        class="bg-black/80 backdrop-blur-md text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg border border-white/10 flex items-center gap-2 pointer-events-auto"
      >
        <svg v-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
        <svg v-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 001 1h2a1 1 0 001-1V6a1 1 0 00-1-1h-2z" clip-rule="evenodd" /></svg>
        <span>{{ toast.text }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}
</style>