<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import alipayQrcode from '../../assets/alipay.jpg';
import wechatpayQrcode from '../../assets/wechatpay.png';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits(['update:visible']);

const isClosing = ref(false);

const handleClose = () => {
  isClosing.value = true;
  setTimeout(() => {
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

// Handle Escape key
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto"
      :class="{'pointer-events-none': isClosing}"
    >
      <!-- Backdrop with blur effect -->
      <div
        class="fixed inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Container -->
      <div
        class="relative w-full max-w-lg transform overflow-hidden rounded-3xl border border-white/20 bg-white/80 p-6 text-center shadow-2xl transition-all duration-300 cubic-bezier dark:border-white/10 dark:bg-gray-900/90 backdrop-blur-lg flex flex-col max-h-[90vh] md:max-h-[85vh]"
        :class="isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0'"
      >
        <!-- Close Button -->
        <button
          type="button"
          class="absolute right-4 top-4 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/5 text-gray-500 transition hover:bg-black/10 hover:text-gray-800 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="关闭"
          @click="handleClose"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <!-- Header (Fixed) -->
        <div class="mb-4 flex flex-col items-center flex-shrink-0">
          <div class="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/30 text-rose-500 animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
            </svg>
          </div>
          <h3 class="text-lg font-extrabold text-gray-900 dark:text-white">支持作者</h3>
        </div>

        <!-- Scrollable Content Area -->
        <div class="flex-1 overflow-y-auto pr-1.5 -mr-1.5 custom-scrollbar pb-2 text-center">
          <!-- Description Paragraph -->
          <p class="mb-5 px-1 text-xs sm:text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            本项目完全由个人作者开发，投入了很多时间精力。您的支持将会对本项目的长期更新做出杰出贡献！赞助者的反馈将优先采用。
          </p>

          <!-- Main QR Code grid -->
          <div class="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <!-- Alipay Card -->
            <div class="flex flex-col items-center rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50/50 to-blue-50/10 p-4 sm:p-5 dark:border-sky-950/20 dark:from-sky-950/10 dark:to-blue-950/5">
              <div class="flex h-28 w-28 sm:h-32 sm:w-32 items-center justify-center rounded-xl border border-sky-200/60 bg-white shadow-sm overflow-hidden dark:border-sky-900/40 dark:bg-gray-800 group transition-all duration-300 hover:shadow-md hover:scale-[1.03]">
                <img 
                  :src="alipayQrcode" 
                  alt="支付宝收款码" 
                  class="h-full w-full object-contain p-1 bg-white transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            </div>

            <!-- WeChat Card -->
            <div class="flex flex-col items-center rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-green-50/10 p-4 sm:p-5 dark:border-emerald-950/20 dark:from-emerald-950/10 dark:to-green-950/5">
              <div class="flex h-28 w-28 sm:h-32 sm:w-32 items-center justify-center rounded-xl border border-emerald-200/60 bg-white shadow-sm overflow-hidden dark:border-emerald-900/40 dark:bg-gray-800 group transition-all duration-300 hover:shadow-md hover:scale-[1.03]">
                <img 
                  :src="wechatpayQrcode" 
                  alt="微信收款码" 
                  class="h-full w-full object-contain p-1 bg-white transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            </div>
          </div>

          <!-- Tiers Description List -->
          <div class="mb-5 space-y-3 rounded-2xl bg-gray-50/40 p-4 text-left dark:bg-white/5 border border-gray-100/50 dark:border-white/5">
            <!-- Tier 1 -->
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-lg dark:bg-amber-950/20">
                🍳
              </div>
              <p class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                一元请作者早餐加个鸡蛋。
              </p>
            </div>

            <!-- Tier 5 -->
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-500/10 text-lg dark:bg-pink-950/20">
                🥤
              </div>
              <p class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                五元请作者喝一杯蜜雪冰城。
              </p>
            </div>

            <!-- Tier 15 -->
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-lg dark:bg-rose-950/20">
                🍱
              </div>
              <p class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                十五元请作者吃一顿午餐。
              </p>
            </div>
          </div>

          <!-- Heartwarming conclusion -->
          <p class="mb-2 px-2 text-xs sm:text-sm font-bold text-[#EC4141] dark:text-[#f85c5c] animate-pulse leading-normal">
            不论您是否赞助，不论您赞助金额多少，非常感谢您对本项目的支持！
          </p>
        </div>

        <!-- Close button at the bottom (Fixed) -->
        <button
          type="button"
          class="w-full flex-shrink-0 mt-3 rounded-2xl bg-gray-100 py-2.5 text-xs sm:text-sm font-semibold text-gray-700 transition hover:bg-gray-200 active:scale-[0.98] dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
          @click="handleClose"
        >
          我知道了
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.25);
  border-radius: 99px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(156, 163, 175, 0.45);
}
</style>
