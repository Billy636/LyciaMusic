<script setup lang="ts">
import { useLyrics, lyricsSettings } from '../../composables/lyrics';
import { usePlayer } from '../../composables/player';
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';

const { showDesktopLyrics, currentLyricLine } = useLyrics();
const { stepSeek, prevSong, togglePlay, nextSong, isPlaying, toggleAlwaysOnTop } = usePlayer();

// --- 窗口移动逻辑 ---
const lyricBoxRef = ref<HTMLElement | null>(null);
const position = ref({ x: window.innerWidth / 2 - 350, y: window.innerHeight - 200 });
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

const startDrag = (e: MouseEvent) => {
  if (lyricsSettings.isLocked) return; 
  if ((e.target as HTMLElement).closest('button, .settings-menu')) return;
  
  isDragging.value = true;
  if (lyricBoxRef.value) {
    const rect = lyricBoxRef.value.getBoundingClientRect();
    dragOffset.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
};

const onMouseMove = (e: MouseEvent) => {
  if (isDragging.value) {
    position.value = { x: e.clientX - dragOffset.value.x, y: e.clientY - dragOffset.value.y };
  }
};

const stopDrag = () => { isDragging.value = false; };

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopDrag);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', stopDrag);
});

// --- 🟢 修复：设置菜单交互 (添加延时器) ---
const showSettings = ref(false);
const showForeignSubmenu = ref(false); 
const showColorSubmenu = ref(false);   
let closeTimer: any = null;

const openSettings = () => { 
  if (closeTimer) clearTimeout(closeTimer); // 如果有待关闭的任务，取消它
  showSettings.value = true; 
};

const closeSettings = () => { 
  // 延迟 300ms 关闭，给用户鼠标移动的时间
  closeTimer = setTimeout(() => {
    showSettings.value = false; 
    showForeignSubmenu.value = false; 
    showColorSubmenu.value = false; 
  }, 300);
};

// 保持菜单打开：当鼠标移入菜单本身时，也取消关闭任务
const keepSettingsOpen = () => {
  if (closeTimer) clearTimeout(closeTimer);
};

const toggleTop = () => {
  lyricsSettings.isAlwaysOnTop = !lyricsSettings.isAlwaysOnTop;
  toggleAlwaysOnTop(lyricsSettings.isAlwaysOnTop);
};

const toggleLock = () => { lyricsSettings.isLocked = !lyricsSettings.isLocked; };
const closeLyrics = () => { showDesktopLyrics.value = false; };

const colorStyles = computed(() => {
  switch(lyricsSettings.colorScheme) {
    case 'pink': return { main: 'text-pink-400', sub: 'text-pink-200' };
    case 'blue': return { main: 'text-blue-400', sub: 'text-blue-200' };
    case 'green': return { main: 'text-emerald-400', sub: 'text-emerald-200' };
    default: return { main: 'text-[#EC4141]', sub: 'text-gray-200' };
  }
});

watch(() => lyricsSettings.isAlwaysOnTop, (val) => toggleAlwaysOnTop(val));

</script>

<template>
  <Teleport to="body">
    <div 
      v-if="showDesktopLyrics"
      ref="lyricBoxRef"
      class="fixed z-[10000] flex flex-col items-center select-none"
      :style="{ left: position.x + 'px', top: position.y + 'px' }"
    >
      
      <div 
        class="group/ctrl absolute bottom-full mb-2 transition-all duration-300 opacity-0 hover:opacity-100 flex justify-center w-full z-20"
        :class="{'opacity-100': showSettings}" 
      >
        <div 
          class="flex items-center bg-black/80 backdrop-blur-md rounded-lg px-2 py-1.5 gap-2 shadow-lg border border-white/10"
          @mousedown.stop 
        >
          <button @click="stepSeek(-0.5)" class="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition" title="后退0.5s">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
          <button @click="stepSeek(0.5)" class="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition" title="前进0.5s">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
          
          <div class="w-[1px] h-3 bg-gray-600 mx-1"></div>

          <button @click="prevSong" class="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white transition"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg></button>
          <button @click="togglePlay" class="p-1.5 rounded hover:bg-white/10 text-white hover:text-[#EC4141] transition">
            <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button @click="nextSong" class="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white transition"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg></button>

          <div class="w-[1px] h-3 bg-gray-600 mx-1"></div>

          <div class="relative" @mouseenter="openSettings" @mouseleave="closeSettings">
            <button class="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white transition" title="设置">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>

            <div 
              v-show="showSettings" 
              @mouseenter="keepSettingsOpen" 
              class="settings-menu absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-white/95 backdrop-blur rounded-lg shadow-2xl border border-gray-100 text-xs text-gray-700 py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
            >
              <div @click="toggleTop" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex justify-between items-center transition-colors">
                <div class="flex items-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>总在最前</div>
                <span v-if="lyricsSettings.isAlwaysOnTop" class="text-[#EC4141] font-bold">✓</span>
              </div>
              
              <div class="relative" @mouseenter="showForeignSubmenu=true; showColorSubmenu=false" @mouseleave="showForeignSubmenu=false">
                <div class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex justify-between items-center transition-colors">
                  <div class="flex items-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>外文歌词显示</div>
                  <span class="text-gray-400">›</span>
                </div>
                <div v-show="showForeignSubmenu" class="absolute left-full top-0 ml-1 w-36 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-gray-100 py-1 z-50">
                  <div @click="lyricsSettings.showTranslation = !lyricsSettings.showTranslation" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span>翻译</span>
                    <span v-if="lyricsSettings.showTranslation" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                  <div @click="lyricsSettings.showRomaji = !lyricsSettings.showRomaji" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span>音译</span>
                    <span v-if="lyricsSettings.showRomaji" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                </div>
              </div>

              <div class="relative" @mouseenter="showColorSubmenu=true; showForeignSubmenu=false" @mouseleave="showColorSubmenu=false">
                <div class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex justify-between items-center transition-colors">
                  <div class="flex items-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>更换配色</div>
                  <span class="text-gray-400">›</span>
                </div>
                <div v-show="showColorSubmenu" class="absolute left-full top-0 ml-1 w-36 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-gray-100 py-1 z-50">
                  <div @click="lyricsSettings.colorScheme = 'default'" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span class="text-[#EC4141]">默认红</span>
                    <span v-if="lyricsSettings.colorScheme === 'default'" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                  <div @click="lyricsSettings.colorScheme = 'pink'" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span class="text-pink-500">樱花粉</span>
                    <span v-if="lyricsSettings.colorScheme === 'pink'" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                  <div @click="lyricsSettings.colorScheme = 'blue'" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span class="text-blue-500">天空蓝</span>
                    <span v-if="lyricsSettings.colorScheme === 'blue'" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                  <div @click="lyricsSettings.colorScheme = 'green'" class="px-4 py-2 hover:bg-gray-100 cursor-pointer flex justify-between">
                    <span class="text-emerald-500">清新绿</span>
                    <span v-if="lyricsSettings.colorScheme === 'green'" class="text-[#EC4141] font-bold">✓</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="w-[1px] h-3 bg-gray-600 mx-1"></div>

          <button @click="toggleLock" class="p-1.5 rounded hover:bg-white/10 transition" :class="lyricsSettings.isLocked ? 'text-[#EC4141]' : 'text-gray-300 hover:text-white'" title="锁定位置">
            <svg v-if="lyricsSettings.isLocked" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clip-rule="evenodd" /></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
          </button>

          <button @click="closeLyrics" class="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white transition" title="关闭歌词">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div 
        class="group/lyrics relative bg-black/60 backdrop-blur-md rounded-2xl shadow-2xl border border-white/5 transition-all duration-300 flex flex-col justify-center items-center px-6 z-10"
        style="width: 700px; height: 130px;"
        :style="{ 
          cursor: lyricsSettings.isLocked ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          opacity: isDragging ? 0.9 : 1
        }"
        @mousedown="startDrag"
      >
        <div v-if="!lyricsSettings.isLocked" class="absolute inset-0 rounded-2xl border-2 border-white/0 group-hover/lyrics:border-white/10 transition-colors pointer-events-none"></div>

        <div class="flex flex-col items-center justify-center w-full text-center">
          
          <div class="text-[28px] font-bold text-white tracking-wide drop-shadow-md text-glow leading-tight w-full truncate px-4" v-if="currentLyricLine.lines[0]">
            {{ currentLyricLine.lines[0] }}
          </div>

          <div 
            v-if="currentLyricLine.lines[1]" 
            class="text-[20px] font-medium mt-1 drop-shadow-sm opacity-95 w-full truncate px-4"
            :class="colorStyles.main"
          >
            {{ currentLyricLine.lines[1] }}
          </div>

          <div 
            v-if="currentLyricLine.lines[2]" 
            class="text-base font-medium mt-0.5 tracking-wider w-full truncate px-4"
            :class="colorStyles.sub"
          >
            {{ currentLyricLine.lines[2] }}
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.text-glow {
  text-shadow: 0 0 12px rgba(0,0,0,0.6), 0 0 4px rgba(255,255,255,0.3);
}
.settings-menu {
  z-index: 99999 !important; 
}
</style>