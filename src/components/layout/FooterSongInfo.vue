<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Song } from '../../types';
import type { FooterBehavior } from '../../types/footer';

const props = defineProps<{
  mode: FooterBehavior['info']; width: number; song: Song | null; cover: string;
  currentTime: string; totalTime: string; expanded: boolean;
  downloadLabel?: string; preview?: boolean;
}>();
defineEmits<{ toggle: [] }>();
const hasCover = computed(() => ['cover', 'song', 'both'].includes(props.mode) && props.width >= 48);
const textKind = computed(() => props.mode === 'time' ? 'time'
  : props.mode === 'song' || props.mode === 'both' ? 'song' : null);
const textMode = computed<FooterBehavior['info']>(previous => textKind.value ? props.mode : previous ?? 'time');
const textOffset = computed(() => (textMode.value === 'song' || textMode.value === 'both') && retainedWidth.value >= 48 ? 60 : 0);
const retainedWidth = ref(props.width);
watch([() => props.width, textKind], ([width, kind]) => {
  // Keep outgoing copy legible while the layout reclaims its area for cover/none.
  if (kind) retainedWidth.value = width;
}, { immediate: true });
</script>

<template>
  <div :data-player-song-info="preview ? undefined : ''" class="footer-info-root relative h-full pointer-events-none"
    :style="{ width: `${Math.max(width, retainedWidth)}px` }">
    <!-- This anchor stays mounted; the shared large cover owns its own motion. -->
    <button type="button" :data-footer-cover="preview ? undefined : ''" title="切换播放页"
      class="absolute left-0 top-1/2 h-12 w-12 -translate-y-1/2 overflow-hidden rounded-lg"
      :class="hasCover && !preview ? 'pointer-events-auto' : 'pointer-events-none'"
      :style="{ opacity: hasCover ? 1 : 0 }" :inert="!hasCover || preview || undefined" :aria-hidden="!hasCover || preview" @click.stop="$emit('toggle')">
      <img v-if="(expanded || preview) && cover && hasCover" :src="cover" class="h-full w-full object-cover" alt="" draggable="false" />
    </button>
    <div class="footer-info-text" :class="{ 'is-detail': expanded }"
      :style="{ width: `${Math.max(0, retainedWidth - textOffset)}px`, transform: `translateX(${textOffset}px)` }"
      :aria-hidden="!textKind" :inert="!textKind || preview || undefined">
      <Transition name="footer-copy">
        <div v-if="textKind" :key="textKind" class="footer-info-copy"
          :class="{ 'pointer-events-auto cursor-pointer': song && !preview }">
          <template v-if="textKind === 'song'">
            <div class="footer-info-title truncate text-sm font-semibold">{{ song ? song.title || song.name.replace(/\.[^/.]+$/, '') : '听我想听的音乐' }}</div>
            <div class="footer-info-secondary truncate text-xs" :class="{ 'tabular-nums': textMode === 'both' }">{{ downloadLabel || (textMode === 'song' ? song?.artist || 'My Music' : `${currentTime} / ${totalTime}`) }}</div>
          </template>
          <div v-else class="footer-info-secondary truncate text-[12px] font-semibold tabular-nums tracking-wide">
            <template v-if="downloadLabel">{{ downloadLabel }}</template>
            <template v-else>{{ currentTime }} <span class="mx-1 opacity-75">/</span> {{ totalTime }}</template>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.footer-info-text { position:absolute; left:0; top:50%; height:40px; margin-top:-20px; transition:transform 400ms cubic-bezier(.4,0,.2,1); }
.footer-info-copy { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; min-width:0; }
.footer-info-secondary { color:var(--app-text-secondary, #4b5563); }
.is-detail .footer-info-secondary { color:#f1f5f9; }
.footer-copy-enter-active,.footer-copy-leave-active { transition:opacity 340ms cubic-bezier(.22,1,.36,1),transform 400ms cubic-bezier(.22,1,.36,1); }
.footer-copy-enter-from { opacity:0; transform:translate(-10px,-14px); }
.footer-copy-leave-to { opacity:0; transform:translate(10px,14px); }
.footer-copy-leave-active { pointer-events:none !important; }
@media(prefers-reduced-motion:reduce) { .footer-info-text,.footer-copy-enter-active,.footer-copy-leave-active { transition:none; } }
</style>
