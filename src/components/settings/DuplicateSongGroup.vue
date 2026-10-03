<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ChevronDown, Disc3, EyeOff, FolderOpen, Pause, Play, ShieldCheck } from 'lucide-vue-next';
import AppCheckbox from '../common/AppCheckbox.vue';
import type { DuplicateGroup } from '../../features/duplicates/store';
import type { DuplicateSong } from '../../features/duplicates/types';

const props = defineProps<{
  group: DuplicateGroup;
  selectedPaths: Set<string>;
  disabled: boolean;
  matchLabel: string;
  playingPath?: string;
}>();
const emit = defineEmits<{
  toggle: [path: string];
  retain: [groupId: string, path: string];
  ignore: [groupId: string];
  play: [song: DuplicateSong];
  reveal: [path: string];
}>();
const expanded = ref(true);
const bodyId = useId();
const selectedCount = computed(() => props.group.songs.filter(song => props.selectedPaths.has(song.path)).length);
const retainedPath = computed(() => selectedCount.value === props.group.songs.length - 1
  ? props.group.songs.find(song => !props.selectedPaths.has(song.path))?.path
  : undefined);

const formatSize = (bytes: number) => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const formatDuration = (seconds: number) => seconds > 0
  ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  : '时长未知';
const quality = (song: DuplicateSong) => [
  song.bit_depth ? `${song.bit_depth} bit` : '',
  song.sample_rate ? `${Number((song.sample_rate / 1000).toFixed(1))} kHz` : '',
].filter(Boolean).join(' / ') || (song.bitrate ? '' : '参数未知');
const formatLabel = (song: DuplicateSong) => [song.format, song.codec && song.codec.toLowerCase() !== song.format.toLowerCase() ? song.codec : '']
  .filter(Boolean).join(' · ').toUpperCase() || 'AUDIO';
const qualitySummary = (song: DuplicateSong) => [
  formatLabel(song), quality(song), song.bitrate ? `${song.bitrate} kbps` : '',
].filter(Boolean).join(' · ');
</script>

<template>
  <article class="duplicate-group" :aria-label="`${group.title}的重复版本`">
    <header class="group-heading">
      <div class="group-summary">
        <span class="group-disc"><Disc3 :size="24" :stroke-width="1.5" aria-hidden="true" /></span>
        <span class="group-name">
          <span class="group-title"><span class="group-title-text">{{ group.title }}</span><span class="version-count">{{ group.songs.length }} 个版本</span></span>
          <span class="group-subtitle app-text-secondary">{{ group.artist || '未知歌手' }}<span class="dot">·</span>{{ matchLabel }}</span>
        </span>
      </div>
      <span class="column-heading quality-heading app-text-secondary" aria-hidden="true">音质参数</span>
      <span class="column-heading size-heading app-text-secondary" aria-hidden="true">大小</span>
      <span class="column-heading duration-heading app-text-secondary" aria-hidden="true">时长</span>
      <div class="heading-actions">
        <button type="button" class="icon-button ignore-button app-text-secondary" :disabled="disabled" :aria-label="`忽略 ${group.title} 这一组`" title="本次结果中忽略此组，不改动文件" @click="emit('ignore', group.id)">
          <EyeOff :size="17" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button expand-button app-text-secondary" :aria-expanded="expanded" :aria-controls="bodyId" :aria-label="`${expanded ? '折叠' : '展开'} ${group.title}`" :title="expanded ? '折叠此组' : '展开此组'" @click="expanded = !expanded">
          <ChevronDown :size="18" class="expand-icon" :class="{ collapsed: !expanded }" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div v-if="expanded" :id="bodyId" class="group-body">
      <div v-for="song in group.songs" :key="song.path" class="file-row" :class="{ 'is-selected': selectedPaths.has(song.path) }">
        <AppCheckbox class="file-checkbox" :checked="selectedPaths.has(song.path)" :disabled="disabled || (!selectedPaths.has(song.path) && selectedCount === group.songs.length - 1)"
          :aria-label="`选择 ${song.name}`" :title="retainedPath === song.path ? '每组至少保留一个版本' : '勾选后可移动到文件夹或删除'" @change="emit('toggle', song.path)" />
        <div class="file-name-cell">
          <div class="file-name-line">
            <span class="file-name" :title="song.name">{{ song.name }}</span>
            <span v-if="retainedPath === song.path" class="file-badge retained"><ShieldCheck :size="12" aria-hidden="true" />已保留</span>
            <span v-else-if="song.path === group.recommendedPath && !selectedPaths.has(song.path)" class="file-badge recommended" title="仅按格式和音频参数推荐，不代表实际听感">建议保留</span>
            <span v-if="selectedPaths.has(song.path)" class="file-badge pending">待处理</span>
          </div>
          <p class="file-path app-text-secondary" :title="song.path">{{ song.path }}</p>
        </div>
        <div class="file-quality">
          <span class="metadata-label app-text-secondary">音质参数</span>
          <span class="quality-values app-text-secondary" :title="qualitySummary(song)">{{ qualitySummary(song) }}</span>
        </div>
        <div class="file-size">
          <span class="metadata-label app-text-secondary">大小</span>
          <span>{{ formatSize(song.file_size) }}</span>
        </div>
        <div class="file-duration">
          <span class="metadata-label app-text-secondary">时长</span>
          <span>{{ formatDuration(song.duration) }}</span>
        </div>
        <div class="file-actions">
          <div class="icon-actions">
            <button type="button" class="icon-button app-text-secondary" :disabled="disabled" :aria-label="`${playingPath === song.path ? '暂停' : '试听'} ${song.name}`" :title="playingPath === song.path ? '暂停试听' : '试听此版本'" @click="emit('play', song)">
              <Pause v-if="playingPath === song.path" :size="16" aria-hidden="true" /><Play v-else :size="16" aria-hidden="true" />
            </button>
            <button type="button" class="icon-button app-text-secondary" :disabled="disabled" :aria-label="`定位 ${song.name}`" title="在文件夹中显示" @click="emit('reveal', song.path)"><FolderOpen :size="17" aria-hidden="true" /></button>
          </div>
          <button type="button" class="retain-button" :disabled="disabled || retainedPath === song.path" :aria-label="`保留 ${song.name} 此版本`" @click="emit('retain', group.id, song.path)">保留此版本</button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.duplicate-group { --file-columns: 20px minmax(0, 2.4fr) minmax(270px, 1.6fr) minmax(76px, .4fr) minmax(62px, .35fr) 80px; overflow: hidden; border: 1px solid rgb(255 255 255 / .48); border-radius: 12px; background: rgb(255 255 255 / .20); }
.group-heading, .file-row { display: grid; grid-template-columns: var(--file-columns); align-items: center; column-gap: 14px; padding: 10px 20px; }
.group-heading { min-height: 68px; background: rgb(255 255 255 / .2); }
.group-summary { grid-column: 1 / 3; display: flex; align-items: center; gap: 12px; min-width: 0; text-align: left; }
.group-disc { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border: 1px solid rgb(236 65 65 / .10); border-radius: 10px; background: rgb(236 65 65 / .055); color: #cf4141; }
.group-name { min-width: 0; flex: 1; }
.group-title { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 16px; font-weight: 600; }
.group-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.version-count { flex-shrink: 0; font-size: 12px; font-weight: 400; padding: 2px 7px; border-radius: 4px; background: rgb(0 0 0 / .035); }
.group-subtitle { display: block; margin-top: 4px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { margin: 0 7px; opacity: .6; }
.expand-icon { flex-shrink: 0; transition: transform .18s; }
.expand-icon.collapsed { transform: rotate(-90deg); }
.column-heading { font-size: 13px; font-weight: 500; text-align: center; }
.quality-heading { grid-column: 3; }
.size-heading { grid-column: 4; }
.duration-heading { grid-column: 5; }
.heading-actions { grid-column: 6; display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
.file-row { min-height: 76px; border-top: 1px solid var(--settings-divider); transition: background .15s; }
.file-row:hover { background: rgb(255 255 255 / .2); }
.file-row.is-selected { background: rgb(236 65 65 / .045); }
.file-checkbox { grid-column: 1; }
.file-name-cell { grid-column: 2; min-width: 0; }
.file-name-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
.file-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 15px; font-weight: 500; }
.file-badge { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: 12px; padding: 2px 6px; border-radius: 4px; }
.recommended, .retained { background: rgb(16 185 129 / .1); color: #087f5b; }
.pending { background: rgb(236 65 65 / .08); color: #c73333; }
.file-path { margin-top: 5px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; user-select: text; }
.file-quality, .file-size, .file-duration { display: flex; align-items: center; justify-content: center; min-width: 0; gap: 5px; font-size: 13px; font-variant-numeric: tabular-nums; }
.file-quality { grid-column: 3; }
.file-size { grid-column: 4; white-space: nowrap; }
.file-duration { grid-column: 5; white-space: nowrap; }
.metadata-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.quality-values { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.file-actions { grid-column: 6; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.icon-actions { display: flex; gap: 4px; }
.icon-button { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 5px; cursor: pointer; }
.icon-button:hover { background: rgb(0 0 0 / .05); color: #EC4141; }
.retain-button { font-size: 12px; padding: 3px; color: #bf3636; cursor: pointer; }
.retain-button:disabled { color: var(--app-text-secondary); opacity: .6; }
button:disabled { cursor: not-allowed; opacity: .45; }
button:focus-visible, .file-checkbox:focus-visible { box-shadow: 0 0 0 2px rgb(236 65 65 / .55); border-radius: 5px; }
.dark .duplicate-group { background: rgb(255 255 255 / .025); border-color: rgb(255 255 255 / .09); }
.dark .group-heading { background: rgb(255 255 255 / .025); }
.dark .group-disc { background: rgb(236 65 65 / .10); color: #ff9393; }
.dark .version-count { background: rgb(255 255 255 / .065); }
.dark .file-row { border-color: var(--settings-divider); }
.dark .file-row:hover { background: rgb(255 255 255 / .025); }
.dark .file-row.is-selected { background: rgb(236 65 65 / .07); }
.dark .recommended, .dark .retained { color: #72d9b2; }
.dark .pending, .dark .retain-button { color: #ff9393; }
.dark .icon-button:hover { background: rgb(255 255 255 / .07); }
@container duplicates (max-width: 900px) {
  .group-heading { grid-template-columns: minmax(0, 1fr) auto; gap: 14px; }
  .group-summary { grid-column: 1; }
  .column-heading { display: none; }
  .heading-actions { grid-column: 2; }
  .file-row { grid-template-columns: 20px minmax(0, 1fr) auto; row-gap: 6px; column-gap: 12px; }
  .file-checkbox { grid-column: 1; grid-row: 1 / 5; align-self: start; margin-top: 3px; }
  .file-name-cell { grid-column: 2; grid-row: 1; }
  .file-quality, .file-size, .file-duration { grid-column: 2; justify-content: flex-start; align-items: baseline; gap: 12px; }
  .file-quality { grid-row: 2; }
  .file-size { grid-row: 3; }
  .file-duration { grid-row: 4; }
  .metadata-label { position: static; width: 4em; height: auto; margin: 0; overflow: visible; clip-path: none; flex-shrink: 0; font-size: 12px; }
  .file-actions { grid-column: 3; grid-row: 1 / 5; align-self: start; }
  .group-disc { display: none; }
}
@container duplicates (max-width: 540px) {
  .group-heading, .file-row { padding: 10px 14px; }
  .file-name-line { flex-wrap: wrap; }
  .file-name { flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) { .expand-icon, .file-row { transition: none; } }
</style>
