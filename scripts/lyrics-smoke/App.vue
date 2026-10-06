<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import LyricsView from '../../src/components/player/LyricsView.vue';
import LyricsAppearancePanel from '../../src/components/player/LyricsAppearancePanel.vue';
import { readLyricsAppearanceDraft } from '../../src/components/player/useLyricsAppearanceDraft';
import { usePlaybackStore } from '../../src/features/playback/store';
import { useSettingsStore } from '../../src/features/settings/store';
import { useUiStore } from '../../src/shared/stores/ui';
import { loadLyrics, lyricsIssues, lyricsStatus, nativeAmlLyrics, showLyricsPlayerSettingsPanel } from '../../src/composables/lyrics';
import { setMainWindowRenderingSnapshot } from '../../src/composables/renderingPower';
import { selectFixture, type FixtureName } from './fixtures';

const playback = usePlaybackStore();
const settings = useSettingsStore();
const appearancePreview = ref(readLyricsAppearanceDraft(settings.settings.lyrics));
const ui = useUiStore();
const fixture = ref<FixtureName>('ttml');
const hidden = ref(false);
const mounted = ref(true);
const position = computed(() => playback.currentTime.toFixed(2));
ui.showPlayerDetail = true;
settings.patchSettings({ lyrics: { showTranslation: true, showRomaji: true, playerRenderMode: 'amll' } });
playback.currentSong = {
  path: '/synthetic/lyrics-demo.flac', name: 'lyrics-demo.flac', title: '歌词回归样本', artist: 'Lycia', album: 'Test', duration: 20,
  artist_names: ['Lycia'], effective_artist_names: ['Lycia'], album_artist: 'Lycia', album_key: 'smoke',
  is_various_artists_album: false, collapse_artist_credits: false,
};
playback.isSongLoaded = true;
playback.currentTime = 2.5;

async function reload() {
  selectFixture(fixture.value);
  playback.currentTime = 2.5;
  playback.clockRevision += 1;
  playback.seekRevision += 1;
  await loadLyrics();
}
function seek(event: Event) {
  playback.currentTime = Number((event.target as HTMLInputElement).value);
  playback.clockRevision += 1;
  playback.seekRevision += 1;
}
function togglePower() {
  hidden.value = !hidden.value;
  setMainWindowRenderingSnapshot({ windowVisible: !hidden.value });
}
function syncVisibility() {
  setMainWindowRenderingSnapshot({ documentHidden: document.hidden });
}
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  syncVisibility();
  document.addEventListener('visibilitychange', syncVisibility);
  void reload();
  timer = setInterval(() => {
    if (!playback.isPlaying) return;
    playback.currentTime = (playback.currentTime + 0.1) % 20;
  }, 100);
});
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', syncVisibility);
});
</script>

<template>
  <main class="smoke-page">
    <header>
      <strong>AMLL 0.6 · 歌词回归预览</strong>
      <select v-model="fixture" aria-label="歌词格式" @change="reload"><option value="ttml">TTML 对唱</option><option value="lrc">LRC 翻译</option><option value="eslrc">逐字 ESLRC</option><option value="multilingual">三行/两行混合 LRC</option></select>
      <button @click="playback.isPlaying = !playback.isPlaying">{{ playback.isPlaying ? '暂停' : '播放' }}</button>
      <button @mousedown.stop @click.stop="showLyricsPlayerSettingsPanel = !showLyricsPlayerSettingsPanel">歌词设置</button>
      <button @click="togglePower">{{ hidden ? '恢复渲染' : '低功耗' }}</button>
      <button @click="mounted = !mounted">{{ mounted ? '卸载歌词' : '挂载歌词' }}</button>
      <label>进度 <input type="range" aria-label="播放进度" min="0" max="20" step="0.05" :value="playback.currentTime" @input="seek" /> {{ position }}s</label>
    </header>
    <LyricsAppearancePanel @preview="appearancePreview = $event" />
    <section class="lyric-surface"><LyricsView v-if="mounted" :appearance-preview="appearancePreview" /></section>
    <footer>仅使用本地合成样本，不读取音乐库、不播放音频。状态：{{ lyricsStatus }} · {{ nativeAmlLyrics.length }} 行 · {{ lyricsIssues.join('；') }}<span v-if="fixture === 'multilingual'"> · 此样例三行源顺序：罗马音 → 原文 → 翻译</span></footer>
    <pre id="error" />
  </main>
</template>

<style scoped>
.smoke-page { height: 100vh; color: #fff; background: radial-gradient(at 25% 20%, #344660, #0b1222 75%); display: flex; flex-direction: column; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 16px 24px; font-size: 14px; }
button, select { border: 1px solid #ffffff40; background: #162139; color: white; border-radius: 8px; padding: 6px 10px; }
label { display: flex; gap: 8px; align-items: center; }
.lyric-surface { width: 55%; flex: 1; min-height: 0; margin-left: 43%; }
/* The real app has minWidth=960. Keep this standalone test page usable in a narrow browser. */
@media (max-width: 959px) {
  .lyric-surface { width: 100%; margin-left: 0; }
}
footer { font-size: 12px; padding: 12px 24px; color: #c6cedd; }
#error { color: #ffb3b3; white-space: pre-wrap; }
</style>
