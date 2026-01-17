<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../composables/toast';

export interface TagMatchTask {
  path: string;
  filename: string;
  status: 'pending' | 'searching' | 'matched' | 'failed' | 'done';
  currentMatch?: OnlineMetadata;
}

export interface OnlineMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url?: string;
  source: string;
  song_id: string;
  album_id: string;
  // Extended fields
  year?: string;
  track_number?: number;
  disc_number?: number;
  genre?: string;
  lyrics?: string;
}

const props = defineProps<{
  visible: boolean;
  files: string[]; // List of file paths to process
}>();

const emit = defineEmits(['close', 'complete']);
const toast = useToast();

const tasks = ref<TagMatchTask[]>([]);
const selectedTaskIndex = ref<number>(0);
const searchResults = ref<OnlineMetadata[]>([]);
const isSearching = ref(false);
const searchKeyword = ref('');
const searchSource = ref<'netease' | 'qq'>('netease');

// Tag options - user can select which tags to write
const tagOptions = ref({
  match_title: true,
  match_artist: true,
  match_album: true,
  match_cover: true,
  match_year: true,
  match_track: false,
  match_disc: false,
  match_genre: false,
  match_lyrics: false
});

// Initialize tasks when opened
watch(() => props.visible, (newVal) => {
  if (newVal && props.files.length > 0) {
    tasks.value = props.files.map(path => {
        // Simple clean for default keyword: remove extension
        const parts = path.split(/[\\/]/);
        let filename = parts[parts.length - 1];
        const extIndex = filename.lastIndexOf('.');
        if (extIndex > 0) filename = filename.substring(0, extIndex);
        
        return {
          path,
          filename,
          status: 'pending'
        };
    });
    selectedTaskIndex.value = 0;
    autoMatchTask(0); // Optional: auto start first one
  }
});

const currentTask = computed(() => tasks.value[selectedTaskIndex.value]);

const selectTask = (index: number) => {
  selectedTaskIndex.value = index;
  const task = tasks.value[index];
  
  // Always set searchKeyword to filename (user can edit it)
  searchKeyword.value = cleanFilename(task.filename);
  
  // If already matched, show the match; otherwise clear results for fresh search
  if (task.currentMatch) {
      searchResults.value = [task.currentMatch];
  } else {
      searchResults.value = [];
      // Auto-search only for pending tasks
      if (task.status === 'pending') {
          handleSearch();
      }
  }
};

const cleanFilename = (name: string) => {
    // Remove track numbers like "01. ", "01 - "
    let clean = name.replace(/^\d+[\.\-\s]+/, '');
    // Remove brackets like "[Netease]", "(Official)"
    clean = clean.replace(/\[.*?\]/g, '').replace(/\(.*?\)|\{.*?\}/g, '');
    return clean.trim();
};

const handleSearch = async () => {
    if (!searchKeyword.value) {
        console.log('[TagMatch] searchKeyword is empty, aborting');
        return;
    }
    console.log('[TagMatch] Starting search:', searchKeyword.value, 'source:', searchSource.value);
    isSearching.value = true;
    try {
        const res = await invoke<OnlineMetadata[]>('search_online_tags', {
            keyword: searchKeyword.value,
            source: searchSource.value
        });
        console.log('[TagMatch] Search result:', res);
        searchResults.value = res;
    } catch (e) {
        console.error('[TagMatch] Search error:', e);
        toast.showToast(`搜索失败: ${e}`, 'error');
        searchResults.value = [];
    } finally {
        isSearching.value = false;
    }
};

const applyMatch = (match: OnlineMetadata) => {
    if (!currentTask.value) return;
    currentTask.value.currentMatch = match;
    currentTask.value.status = 'matched';
    toast.showToast('已暂存匹配结果', 'success');
};

const writeTags = async () => {
    const validTasks = tasks.value.filter(t => t.status === 'matched' && t.currentMatch);
    if (validTasks.length === 0) return;

    let successCount = 0;
    for (const task of validTasks) {
        try {
            await invoke('write_music_tags', {
                path: task.path,
                metadata: task.currentMatch,
                options: tagOptions.value
            });
            task.status = 'done';
            successCount++;
        } catch (e) {
            console.error(e);
            task.status = 'failed';
        }
    }
    toast.showToast(`成功写入 ${successCount} 首歌曲标签`, 'success');
    emit('complete');
    emit('close');
};

// Batch Auto Match (MVP)
const autoMatchAll = async () => {
    for (const [index, task] of tasks.value.entries()) {
        if (task.status === 'done') continue;
        
        task.status = 'searching';
        selectedTaskIndex.value = index; // Move UI focus
        const keyword = cleanFilename(task.filename);
        searchKeyword.value = keyword;
        
        try {
            const res = await invoke<OnlineMetadata[]>('search_online_tags', {
                keyword,
                source: 'netease' // Default strict
            });
            
            if (res && res.length > 0) {
                // Heuristic: Pick first one? Or fuzzy match?
                // For MVP: Pick first one
                task.currentMatch = res[0];
                task.status = 'matched';
            } else {
                task.status = 'failed';
            }
        } catch (e) {
            task.status = 'failed';
        }
        
        // Small delay to avoid rate limit
        await new Promise(r => setTimeout(r, 500));
    }
};

const autoMatchTask = (index: number) => {
     // Just helper to trigger search for single item on click
     selectedTaskIndex.value = index;
     searchKeyword.value = cleanFilename(tasks.value[index].filename);
     handleSearch();
}

const formatDuration = (ms: number) => {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}:${sec.toString().padStart(2, '0')}`;
};
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex overflow-hidden border border-white/10">
        
        <!-- Left: File List -->
        <div class="w-1/3 bg-gray-50 dark:bg-black/20 border-r border-gray-200 dark:border-white/5 flex flex-col">
            <div class="p-4 border-b border-gray-200 dark:border-white/5 bg-gray-100/50 dark:bg-white/5">
                <h3 class="font-bold text-gray-800 dark:text-gray-200 mb-1">待处理文件 ({{ tasks.length }})</h3>
                <div class="flex gap-2 mt-2">
                    <button @click="autoMatchAll" class="flex-1 bg-[#EC4141] text-white text-xs py-1.5 rounded-lg hover:bg-red-600 transition">
                        ⚡ 一键自动匹配
                    </button>
                </div>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                <div 
                    v-for="(task, idx) in tasks" 
                    :key="task.path"
                    @click="selectTask(idx)"
                    class="px-3 py-2.5 rounded-lg text-sm cursor-pointer transition flex items-center gap-2 group"
                    :class="selectedTaskIndex === idx ? 'bg-white dark:bg-white/10 shadow-sm ring-1 ring-[#EC4141]/50' : 'hover:bg-gray-200 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400'"
                >
                    <div class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        :class="{
                            'bg-gray-300': task.status === 'pending',
                            'bg-blue-500 animate-pulse': task.status === 'searching',
                            'bg-green-500': task.status === 'matched',
                            'bg-red-500': task.status === 'failed',
                            'bg-[#EC4141]': task.status === 'done'
                        }"
                    ></div>
                    <div class="flex-1 truncate">
                        <div class="font-medium truncate" :class="selectedTaskIndex === idx ? 'text-[#EC4141]' : ''">{{ task.filename }}</div>
                        <div v-if="task.currentMatch" class="text-xs opacity-60 truncate">
                             Matches: {{ task.currentMatch.title }} - {{ task.currentMatch.artist }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Right: Matching Area -->
        <div class="flex-1 flex flex-col bg-white dark:bg-[#2b2b2b]">
            <!-- Search Bar -->
            <div class="p-4 border-b border-gray-200 dark:border-white/5 flex gap-3 items-center">
                <select v-model="searchSource" class="bg-gray-100 dark:bg-white/10 border-none rounded-lg text-sm p-2 outline-none focus:ring-2 focus:ring-[#EC4141]">
                    <option value="netease">网易云音乐</option>
                    <option value="qq">QQ音乐</option>
                </select>
                <input 
                    v-model="searchKeyword" 
                    @keyup.enter="handleSearch"
                    placeholder="输入关键词搜索..." 
                    class="flex-1 bg-gray-100 dark:bg-white/5 border-none rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EC4141] text-gray-800 dark:text-gray-200"
                />
                <button 
                    @click="handleSearch"
                    :disabled="isSearching"
                    class="px-4 py-2 bg-[#EC4141] text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50"
                >
                    {{ isSearching ? '搜索中...' : '搜索' }}
                </button>
            </div>

            <!-- Results -->
            <div class="flex-1 overflow-y-auto custom-scrollbar p-4">
                <div v-if="searchResults.length === 0 && !isSearching" class="h-full flex flex-col items-center justify-center text-gray-400">
                    <div class="text-4xl mb-2">🔍</div>
                    <div>在上方输入关键词开始搜索</div>
                </div>

                <div v-else class="grid grid-cols-1 gap-3">
                    <div 
                        v-for="res in searchResults" 
                        :key="res.song_id"
                        class="flex items-center gap-4 p-3 rounded-xl border border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition group"
                        :class="currentTask?.currentMatch?.song_id === res.song_id ? 'bg-red-50 dark:bg-red-500/10 border-[#EC4141]/30' : ''"
                    >
                        <!-- Cover -->
                        <div class="w-16 h-16 rounded-lg bg-gray-200 dark:bg-white/5 overflow-hidden flex-shrink-0 relative">
                            <img v-if="res.cover_url" :src="res.cover_url" class="w-full h-full object-cover" loading="lazy" />
                            <div v-else class="w-full h-full flex items-center justify-center text-xs text-gray-400">No Cover</div>
                            
                            <!-- Play overlay (Preview not impl yet) -->
                            <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <span class="text-white text-xs">预览</span>
                            </div>
                        </div>

                        <!-- Info -->
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-gray-800 dark:text-gray-100 truncate text-base">{{ res.title }}</div>
                            <div class="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                {{ res.artist }} 
                                <span class="mx-1 opacity-50">•</span> 
                                {{ res.album }}
                            </div>
                            <div class="text-xs text-gray-400 mt-1 flex gap-2">
                                <span class="bg-gray-100 dark:bg-white/10 px-1.5 rounded text-[10px]">{{ formatDuration(res.duration) }}</span>
                                <span class="uppercase border border-gray-200 dark:border-white/10 px-1.5 rounded text-[10px]">{{ res.source }}</span>
                            </div>
                        </div>

                        <!-- Action -->
                        <button 
                            @click="applyMatch(res)"
                            class="px-4 py-2 rounded-lg text-sm font-bold transition flex-shrink-0"
                            :class="currentTask?.currentMatch?.song_id === res.song_id 
                                ? 'bg-[#EC4141] text-white shadow-lg shadow-red-500/30' 
                                : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20'"
                        >
                            {{ currentTask?.currentMatch?.song_id === res.song_id ? '已选择' : '使用' }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Tag Options -->
            <div class="p-3 border-t border-gray-200 dark:border-white/5 bg-gray-50/50 dark:bg-white/5">
                <div class="text-xs text-gray-500 mb-2">写入选项：</div>
                <div class="flex flex-wrap gap-3 text-xs">
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_title" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">标题</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_artist" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">艺术家</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_album" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">专辑</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_cover" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">封面</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_year" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">年份</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" v-model="tagOptions.match_track" class="accent-[#EC4141]" />
                        <span class="text-gray-600 dark:text-gray-300">音轨号</span>
                    </label>
                </div>
            </div>

            <!-- Bottom Actions -->
            <div class="p-4 border-t border-gray-200 dark:border-white/5 flex justify-end gap-3 bg-gray-50/50 dark:bg-white/5">
                <button @click="emit('close')" class="px-6 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-600 hover:bg-gray-100 transition text-sm font-medium">
                    取消
                </button>
                <button 
                    @click="writeTags"
                    class="px-6 py-2.5 rounded-xl bg-[#EC4141] text-white font-bold hover:bg-red-600 transition shadow-lg text-sm flex items-center gap-2"
                >
                    <span>保存全部更改</span>
                    <span v-if="tasks.filter(t => t.status === 'matched').length > 0" class="bg-white/20 px-1.5 rounded text-xs">
                        {{ tasks.filter(t => t.status === 'matched').length }}
                    </span>
                </button>
            </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
