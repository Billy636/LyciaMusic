<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { usePlayer, Song } from '../../composables/player';

const props = defineProps<{
  visible: boolean,
  x: number,
  y: number,
  song: Song | null,
  isPlaylistView: boolean
}>();

const emit = defineEmits(['close', 'addToPlaylist']);

// 引入需要的操作
const { playSong, playNext, removeSongFromList, removeFromPlaylist, openInFinder, deleteFromDisk, filterCondition } = usePlayer();

const menuRef = ref<HTMLElement | null>(null);

// 点击外部自动关闭
const handleGlobalClick = (e: MouseEvent) => {
  if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

const handleAction = (action: string) => {
  if (!props.song) return;
  
  switch(action) {
    case 'play':
      playSong(props.song);
      break;
    case 'playNext':
      playNext(props.song);
      break;
    case 'addToPlaylist':
      emit('addToPlaylist'); // 触发父组件弹窗
      break;
    case 'removeFromList':
      removeSongFromList(props.song);
      break;
    case 'removeFromPlaylist':
      if (props.isPlaylistView) {
        removeFromPlaylist(filterCondition.value, props.song.path);
      }
      break;
    case 'openFolder':
      openInFinder(props.song.path);
      break;
    case 'deleteFromDisk':
      deleteFromDisk(props.song);
      break;
  }
  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible" 
      ref="menuRef"
      class="fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-100 py-1.5 text-sm text-gray-700 min-w-[180px] animate-in fade-in zoom-in-95 duration-75 select-none"
      :style="{ left: x + 'px', top: y + 'px' }"
      @contextmenu.prevent
    >
      <div @click="handleAction('play')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
          </svg>
        </div>
        <span>播放</span>
      </div>

      <div @click="handleAction('playNext')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path d="M5.055 7.06c-1.25-.714-2.805.189-2.805 1.628v8.123c0 1.44 1.555 2.342 2.805 1.628L12 14.471v2.34c0 1.44 1.555 2.342 2.805 1.628l7.108-4.061c1.26-.72 1.26-2.536 0-3.256L14.805 7.06C13.555 6.346 12 7.25 12 8.688v2.34L5.055 7.06z" />
          </svg>
        </div>
        <span>下一首播放</span>
      </div>

      <div @click="handleAction('addToPlaylist')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors border-b border-gray-100 mb-1">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path fill-rule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
          </svg>
        </div>
        <span>收藏到歌单</span>
      </div>

      <template v-if="isPlaylistView">
        <div @click="handleAction('removeFromPlaylist')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clip-rule="evenodd" />
            </svg>
          </div>
          <span>从歌单中删除</span>
        </div>
      </template>

      <template v-else>
        <div @click="handleAction('removeFromList')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clip-rule="evenodd" />
            </svg>
          </div>
          <span>从列表删除</span>
        </div>

        <div @click="handleAction('openFolder')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
            </svg>
          </div>
          <span>打开文件所在目录</span>
        </div>

        <div @click="handleAction('deleteFromDisk')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors text-red-500 hover:text-red-600 border-t border-gray-100 mt-1">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-red-500 group-hover:text-red-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd" />
            </svg>
          </div>
          <span>从本地磁盘删除</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>