import { ref, shallowRef } from 'vue';
import type { Song } from '../../types';
import type { FooterMovableId } from '../../types/footer';

// The shared album cover lives outside the footer's DOM.
export const footerCoverVisible = ref(true);
export const footerCoverAnchor = ref<{ x: number; y: number; width: number; height: number } | null>(null);

// The editor scales this live coordinate space instead of solving a narrower
// layout, which could move buttons to different positions or overflow buckets.
export const footerViewport = ref({ width: 0, height: 80 });
export const footerLivePresentation = shallowRef({
  song: null as Song | null, cover: '', playing: false, playMode: 0, volume: 100,
  expanded: false, currentTime: '0:00', totalTime: '0:00', progress: 0, downloadLabel: '',
  active: {} as Partial<Record<FooterMovableId, boolean>>,
});
