import { ref, computed, reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { currentSong, currentTime, AUDIO_DELAY } from './playerState';

export interface LyricLine {
  time: number;       
  text: string;       
  translation: string;
  romaji: string;     
}

export const lyricsSettings = reactive({
  showTranslation: true, 
  showRomaji: true,      
  isAlwaysOnTop: false,  
  isLocked: false,       
  colorScheme: 'default' as 'default' | 'pink' | 'blue' | 'green', 
});

export const showDesktopLyrics = ref(false); 
const rawLyrics = ref<string>('');
const parsedLyrics = ref<LyricLine[]>([]);

function parseLrc(lrc: string): LyricLine[] {
  const lines = lrc.split('\n');
  const rawEntries: { time: number, text: string }[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = timeExp.exec(line);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3]);
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeExp, '').trim();
      if (text) rawEntries.push({ time, text });
    }
  }

  rawEntries.sort((a, b) => a.time - b.time);

  const result: LyricLine[] = [];
  if (rawEntries.length === 0) return result;

  let currentGroup = { time: rawEntries[0].time, texts: [rawEntries[0].text] };

  for (let i = 1; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    if (Math.abs(entry.time - currentGroup.time) < 0.05) {
      currentGroup.texts.push(entry.text);
    } else {
      result.push(mapGroupToLine(currentGroup));
      currentGroup = { time: entry.time, texts: [entry.text] };
    }
  }
  result.push(mapGroupToLine(currentGroup));
  return result;
}

function mapGroupToLine(group: { time: number, texts: string[] }): LyricLine {
  return {
    time: group.time,
    text: group.texts[0] || '',
    translation: group.texts[1] || '', 
    romaji: group.texts[2] || ''       
  };
}

async function loadLyrics() {
  if (!currentSong.value) {
    rawLyrics.value = '';
    parsedLyrics.value = [];
    return;
  }
  try {
    const lrc = await invoke<string>('get_song_lyrics', { path: currentSong.value.path });
    rawLyrics.value = lrc;
    parsedLyrics.value = parseLrc(lrc);
  } catch (e) {
    console.error("歌词加载失败:", e);
    parsedLyrics.value = [];
  }
}

// 🟢 严格匹配逻辑：找到最后一个“时间小于等于当前时间”的歌词
const currentLyricIndex = computed(() => {
  if (parsedLyrics.value.length === 0) return -1;
  
  // 加上延迟补偿，确保“声音出来后”才高亮
  const targetTime = currentTime.value - AUDIO_DELAY.value;
  
  // 使用倒序查找（效率更高，也更符合逻辑）
  // 从后往前找，找到第一个 time <= targetTime 的就是当前句
  for (let i = parsedLyrics.value.length - 1; i >= 0; i--) {
    if (parsedLyrics.value[i].time <= targetTime) {
      return i;
    }
  }
  return -1; // 还没开始
});

const currentLyricLine = computed(() => {
  if (parsedLyrics.value.length === 0) {
    const fallback = rawLyrics.value.trim() ? '暂无滚动歌词' : '纯音乐 / 暂无歌词';
    return { text: fallback, lines: [fallback] };
  }
  
  const idx = currentLyricIndex.value;

  if (idx !== -1) {
    const current = parsedLyrics.value[idx];
    const linesToShow: string[] = [];
    linesToShow.push(current.text);
    if (lyricsSettings.showTranslation && current.translation) linesToShow.push(current.translation);
    if (lyricsSettings.showRomaji && current.romaji) linesToShow.push(current.romaji);

    return { text: current.text, lines: linesToShow };
  }
  
  const first = parsedLyrics.value[0];
  return { text: first.text, lines: [first.text] };
});

export function useLyrics() {
  return {
    showDesktopLyrics,
    lyricsSettings, 
    currentLyricLine,
    currentLyricIndex, 
    parsedLyrics, 
    loadLyrics
  };
}