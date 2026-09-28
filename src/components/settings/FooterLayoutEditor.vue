<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { MoveHorizontal, RotateCcw, X } from 'lucide-vue-next';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import { footerAction } from '../../features/settings/footer';
import { footerButtonWidth, footerDropPosition, resolveFreeFooterLayout } from '../../features/settings/freeFooterLayout';
import type { FooterMovableId, FooterPlacement, FooterScene } from '../../types/footer';
import FooterIcon from '../layout/FooterIcon.vue';
import FooterActionButton from '../layout/FooterActionButton.vue';
import FooterSongInfo from '../layout/FooterSongInfo.vue';
import { footerViewport, footerEditingScene, footerLivePresentation as live } from '../layout/footerPresentation';

const props = defineProps<{ scene: FooterScene }>();
defineEmits<{ reset: [] }>();
const { footer, setPlacement, setSpacing } = useFooterSettings();
const root = ref<HTMLElement | null>(null), bar = ref<HTMLElement | null>(null), menu = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const previewWidth = ref(800);
const width = computed(() => footerViewport.value.width || previewWidth.value);
const previewScale = computed(() => Math.min(1, previewWidth.value / Math.max(1, width.value)));
const layout = computed(() => resolveFreeFooterLayout(footer.value, props.scene, width.value));
const behavior = computed(() => footer.value.behavior[props.scene]);
const spacing = computed(() => footer.value.spacing[footer.value.linked ? 'main' : props.scene]);
const spacingControlId = useId();
const spacingControls = [
  { key: 'controls', label: '播放按钮间距', min: 8, max: 40, default: 24, hint: '仅调整上一首、播放/暂停、下一首之间的间距' },
  { key: 'utilities', label: '功能按钮间距', min: 0, max: 24, default: 8, hint: '调整播放模式、播放队列、音量、歌词、均衡器等功能按钮的间距' },
] as const;
const previewIconProps = (id: FooterMovableId) => ({
  id: (id === 'play' && live.value.playing ? 'pause' : id) as FooterMovableId | 'pause',
  active: live.value.active[id], playMode: live.value.playMode, volume: live.value.volume,
  pinned: !behavior.value.autoHide, progressHidden: behavior.value.progress === 'hidden',
});
const menuId = ref<FooterMovableId | null>(null);
const menuLeft = ref(0), menuTop = ref(0);
let menuAnchor: HTMLElement | null = null;
type Drop = { visibility: 'bar' | 'more' | 'hidden'; x?: number; normalized?: number };
const drop = ref<Drop | null>(null);
const drag = ref<{ id: FooterMovableId; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean; anchor: HTMLElement } | null>(null);
let observer: ResizeObserver | undefined;
const allIds = computed(() => [...layout.value.bar, ...layout.value.more, ...layout.value.hidden].map(item => item.id));
const dragHint = computed(() => !drag.value?.active ? '' : !drop.value ? '这里放不下，请移到空白位置' : drop.value.visibility === 'bar' ? '松手放在这里 · Esc 取消' : drop.value.visibility === 'more' ? '松手收入更多菜单' : '松手隐藏');

function closeMenu(restore = false) {
  menuId.value = null;
  if (restore) void nextTick(() => (menuAnchor?.isConnected ? menuAnchor : root.value)?.focus({ preventScroll: true }));
}
async function openMenu(id: FooterMovableId, anchor: HTMLElement) {
  menuAnchor = anchor;
  const rect = anchor.getBoundingClientRect(), bounds = root.value!.getBoundingClientRect();
  menuLeft.value = Math.max(8, Math.min(rect.left - bounds.left, bounds.width - 224));
  menuTop.value = rect.bottom - bounds.top + 6;
  menuId.value = id;
  await nextTick();
  if (menuId.value === id) menu.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
}
function choose(visibility: FooterPlacement['visibility']) {
  const id = menuId.value;
  if (!id || !visibility) return;
  setPlacement(props.scene, id, { visibility }, width.value);
  closeMenu(true);
}
function click(event: MouseEvent) {
  if (event.detail !== 0) return;
  const button = (event.target as Element).closest<HTMLElement>('[data-editor-action]');
  const id = button?.dataset.editorAction as FooterMovableId | undefined;
  if (button && id && allIds.value.includes(id)) void openMenu(id, button);
}
function begin(event: PointerEvent) {
  const button = (event.target as Element).closest<HTMLElement>('[data-editor-action]');
  const id = button?.dataset.editorAction as FooterMovableId | undefined;
  if (!button || !id || !allIds.value.includes(id) || !root.value || event.button !== 0 || !event.isPrimary || drag.value) return;
  event.preventDefault(); event.stopPropagation(); closeMenu(); button.focus({ preventScroll: true });
  drag.value = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, anchor: button };
  root.value.setPointerCapture(event.pointerId);
}
function updateDrop() {
  const session = drag.value;
  drop.value = null;
  if (!session?.active || !bar.value) return;
  const hit = document.elementFromPoint(session.x, session.y);
  const pool = hit?.closest<HTMLElement>('[data-editor-pool]');
  if (pool && root.value?.contains(pool)) {
    const visibility = pool.dataset.editorPool as 'more' | 'hidden';
    if (visibility !== 'more' || session.id !== 'more') drop.value = { visibility };
    return;
  }
  const rect = bar.value.getBoundingClientRect();
  if (session.x < rect.left || session.x > rect.right || session.y < rect.top || session.y > rect.bottom) return;
  const position = footerDropPosition(footer.value, props.scene, width.value, session.id, (session.x - rect.left) / previewScale.value);
  if (position) drop.value = { visibility: 'bar', ...position };
}
function move(event: PointerEvent) {
  const session = drag.value;
  if (!session || session.pointerId !== event.pointerId) return;
  event.preventDefault(); session.x = event.clientX; session.y = event.clientY;
  if (Math.hypot(session.x - session.startX, session.y - session.startY) >= 5) session.active = true;
  updateDrop();
}
function cancel() {
  const session = drag.value; drag.value = null; drop.value = null;
  if (session && root.value?.hasPointerCapture(session.pointerId)) root.value.releasePointerCapture(session.pointerId);
}
function finish(event: PointerEvent) {
  const session = drag.value;
  if (!session || session.pointerId !== event.pointerId) return;
  session.x = event.clientX; session.y = event.clientY; updateDrop();
  const target = drop.value;
  cancel();
  if (!session.active) { void openMenu(session.id, session.anchor); return; }
  if (!target) return;
  setPlacement(props.scene, session.id, { visibility: target.visibility, ...(target.normalized !== undefined ? { x: target.normalized } : {}) }, width.value);
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape' && (drag.value || menuId.value)) { event.preventDefault(); event.stopPropagation(); cancel(); closeMenu(true); return; }
  if (menuId.value || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]')?.dataset.editorAction as FooterMovableId;
  const item = layout.value.bar.find(item => item.id === id);
  if (!item) return;
  event.preventDefault(); event.stopPropagation();
  const target = footerDropPosition(footer.value, props.scene, width.value, id, item.x + (event.key === 'ArrowLeft' ? -8 : 8), false);
  if (target) setPlacement(props.scene, id, { visibility: 'bar', x: target.normalized }, width.value);
}
function outside(event: PointerEvent) {
  if (menuId.value && !menu.value?.contains(event.target as Node) && !(event.target as Element).closest('[data-editor-action]')) closeMenu();
}
function interrupt() { cancel(); closeMenu(); }
watch(() => JSON.stringify([props.scene, footer.value.placement, footer.value.spacing, footer.value.behavior[props.scene]]), interrupt);
watch(() => props.scene, scene => { footerEditingScene.value = scene; }, { immediate: true });
watch(width, cancel);
onActivated(() => { footerEditingScene.value = props.scene; });
onDeactivated(() => { footerEditingScene.value = null; interrupt(); });
onMounted(() => {
  observer = new ResizeObserver(entries => { previewWidth.value = entries[0].contentRect.width; cancel(); });
  if (viewport.value) observer.observe(viewport.value);
  window.addEventListener('pointerdown', outside); window.addEventListener('blur', interrupt); window.addEventListener('resize', interrupt);
});
onBeforeUnmount(() => {
  footerEditingScene.value = null;
  cancel(); observer?.disconnect(); window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', interrupt); window.removeEventListener('resize', interrupt);
});
</script>

<template>
  <section ref="root" class="free-footer-editor" tabindex="-1" aria-label="直接摆放底栏按钮" @pointerdown="begin" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel" @click="click" @keydown="keyboard" @dragstart.prevent>
    <div class="editor-toolbar">
      <p class="editor-caption">按实际底栏等比预览。拖动调整位置，点击可隐藏或收入更多。</p>
      <button type="button" class="editor-reset" @click="$emit('reset')">恢复原版布局</button>
    </div>
    <div ref="viewport" class="free-bar" :class="{ 'detail-scene': live.expanded, dragging: drag?.active }"
      :style="{ height: `${footerViewport.height * previewScale + 24}px` }">
      <div ref="bar" class="preview-canvas" :class="live.expanded ? 'text-white' : 'text-gray-800 dark:text-white'"
        :style="{ width: `${width}px`, height: `${footerViewport.height}px`, transform: `translateX(-50%) scale(${previewScale})` }">
      <div v-if="behavior.progress !== 'hidden'" class="preview-progress" :class="{ 'hover-only': behavior.progress === 'hover' }"><div class="preview-progress-track"><span :style="{ width: `${live.progress}%`, backgroundColor: behavior.progressColor || 'rgb(212 212 216 / .3)' }"></span></div></div>
      <div class="preview-song" :style="{ width: `${layout.infoWidth}px` }">
        <FooterSongInfo preview :mode="behavior.info" :song="live.song" :cover="live.cover" :expanded="live.expanded"
          :current-time="live.currentTime" :total-time="live.totalTime" :download-label="live.downloadLabel" />
      </div>
      <FooterActionButton v-for="item in layout.bar" :key="item.id" :id="item.id" editing class="preview-button" :class="{ moving: drag?.active && drag.id === item.id }"
        :style="{ left: `${item.x}px`, width: `${item.width}px`, height: `${item.width}px` }" :data-editor-action="item.id" :label="`编辑${footerAction(item.id).label}`"
        :active="live.active[item.id]" :playing="live.playing" :play-mode="live.playMode" :volume="live.volume" :pinned="!behavior.autoHide" :progress-hidden="behavior.progress === 'hidden'"
        @activate="event => { if (event.detail === 0) openMenu(item.id, event.currentTarget as HTMLElement); }" />
      <div v-if="drag?.active && drop?.visibility === 'bar'" class="drop-ghost" :class="{ 'play-control': drag.id === 'play' }" :style="{ left: `${drop.x}px`, width: `${footerButtonWidth(drag.id)}px`, height: `${footerButtonWidth(drag.id)}px` }" aria-hidden="true"><FooterIcon v-bind="previewIconProps(drag.id)" /></div>
      </div>
    </div>
    <div class="editor-pools">
      <div v-for="pool in (['more', 'hidden'] as const)" :key="pool" class="editor-pool" :data-editor-pool="pool" :class="{ targeted: drag?.active && drop?.visibility === pool }">
        <div class="pool-title">{{ pool === 'more' ? '更多' : '已隐藏' }}</div>
        <div class="pool-items">
          <button v-for="item in layout[pool]" :key="item.id" type="button" class="pool-button" :data-editor-action="item.id" :aria-label="`编辑${footerAction(item.id).label}`"><FooterIcon v-bind="previewIconProps(item.id)" /><span>{{ footerAction(item.id).label }}</span></button>
          <span v-if="!layout[pool].length" class="empty-pool">拖入按钮，或从这里拖回底栏</span>
        </div>
      </div>
    </div>
    <div v-for="control in spacingControls" :key="control.key" class="spacing-row" :title="control.hint">
      <label :for="`${spacingControlId}-${control.key}`" class="spacing-label">
        <span class="spacing-icon"><MoveHorizontal class="h-4 w-4" aria-hidden="true" /></span>
        <span>{{ control.label }}</span>
      </label>
      <div class="spacing-control">
        <span class="spacing-endpoint" aria-hidden="true">紧凑</span>
        <input :id="`${spacingControlId}-${control.key}`" class="spacing-slider" type="range" :min="control.min" :max="control.max" step="1"
          :value="spacing[control.key]" :aria-valuetext="`${spacing[control.key]} 像素`"
          :style="{ '--spacing-fill': `${(spacing[control.key] - control.min) / (control.max - control.min) * 100}%` }"
          @input="setSpacing(scene, { [control.key]: Number(($event.target as HTMLInputElement).value) }, width)" />
        <span class="spacing-endpoint" aria-hidden="true">宽松</span>
      </div>
      <output :for="`${spacingControlId}-${control.key}`" class="spacing-value">{{ spacing[control.key] }}<span>px</span></output>
      <button type="button" class="spacing-reset" :title="`恢复默认${control.label}`" :aria-label="`恢复默认${control.label}`"
        :disabled="spacing[control.key] === control.default"
        @click="setSpacing(scene, { [control.key]: control.default }, width)">
        <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
    <p v-if="dragHint" class="editor-status" role="status" aria-live="polite">{{ dragHint }}</p>
    <div v-if="menuId" ref="menu" class="editor-menu" :style="{ left: `${menuLeft}px`, top: `${menuTop}px` }" :aria-label="`${footerAction(menuId).label}选项`" @pointerdown.stop>
      <div class="menu-heading"><FooterIcon v-bind="previewIconProps(menuId)" /><span>{{ footerAction(menuId).label }}</span><button type="button" aria-label="关闭按钮选项" @click.stop="closeMenu(true)"><X class="h-4 w-4" /></button></div>
      <button v-if="!layout.bar.some(item => item.id === menuId)" type="button" class="menu-option" @click.stop="choose('bar')">放回底栏</button>
      <button v-if="menuId !== 'more' && !layout.more.some(item => item.id === menuId)" type="button" class="menu-option" @click.stop="choose('more')">放入更多</button>
      <button v-if="!layout.hidden.some(item => item.id === menuId)" type="button" class="menu-option" @click.stop="choose('hidden')">隐藏</button>
    </div>
  </section>
</template>

<style scoped>
.free-footer-editor { position:relative; outline:none; }
.editor-toolbar { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:12px; }
.editor-caption { margin:0; font-size:13px; color:#6b7280; }
.editor-reset { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; height:30px; min-width:104px; padding:0 12px; border:1px solid rgb(128 128 128 / .25); border-radius:6px; font-size:12px; white-space:nowrap; }
.editor-reset:hover { background:rgb(128 128 128 / .06); }
.free-bar { position:relative; height:104px; border-radius:12px; background:rgb(128 128 128 / .035); outline:1px solid rgb(128 128 128 / .15); }
.detail-scene { background:linear-gradient(125deg,rgb(128 100 150 / .14),rgb(60 120 160 / .14)); }
.free-bar.dragging { background-image:radial-gradient(rgb(128 128 128 / .2) 1px,transparent 1px); background-size:12px 12px; }
.preview-canvas { position:absolute; left:50%; top:12px; transform-origin:top center; }
.preview-progress { position:absolute; top:-10px; left:0; right:0; height:22px; }
.preview-progress-track { position:absolute; top:50%; left:0; right:0; height:2px; transform:translateY(-50%); }
.preview-progress-track>span { display:block; height:100%; border-radius:999px; }
.preview-progress.hover-only:not(:hover) { opacity:0; }
.preview-song { position:absolute; left:16px; top:0; height:100%; min-width:0; }
.preview-button,.drop-ghost { position:absolute; top:50%; transform:translate(-50%,-50%); display:flex; align-items:center; justify-content:center; border-radius:6px; }
.preview-button { cursor:grab; touch-action:none; }
.play-control { border-radius:50%; background:rgb(128 128 128 / .09); }
.moving { opacity:.2; }
.drop-ghost { outline:2px solid #ec4141; outline-offset:4px; color:#ec4141; pointer-events:none; }
.editor-pools { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
.editor-pool { padding:12px; border:1px dashed rgb(128 128 128 / .25); border-radius:8px; min-width:0; }
.pool-title { font-size:12px; color:#6b7280; margin-bottom:8px; }
.pool-items { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-height:32px; }
.pool-button { display:flex; align-items:center; gap:8px; padding:5px 8px; font-size:12px; border-radius:6px; cursor:grab; touch-action:none; }
.pool-button:hover { background:rgb(128 128 128 / .08); }
.empty-pool { color:#6b7280; font-size:11px; }
.targeted { outline:2px solid #ec4141; }
.spacing-row {
  --spacing-track: rgb(15 23 42 / .1);
  --spacing-muted: #6b7280;
  display:grid;
  grid-template-columns:minmax(144px, 1fr) minmax(160px, 340px) auto auto;
  gap:16px;
  align-items:center;
  margin-top:18px;
  padding:14px 16px;
  border:1px solid rgb(128 128 128 / .14);
  border-radius:12px;
  background:rgb(255 255 255 / .32);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.dark .spacing-row { --spacing-track:rgb(255 255 255 / .16); --spacing-muted:#9ca3af; background:rgb(255 255 255 / .035); border-color:rgb(255 255 255 / .08); }
.spacing-label { display:flex; align-items:center; gap:10px; font-size:13px; font-weight:500; cursor:pointer; }
.spacing-icon { display:flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; border-radius:8px; background:rgb(236 65 65 / .08); color:#ec4141; }
.dark .spacing-icon { color:#ff8b8b; }
.spacing-control { display:flex; align-items:center; gap:12px; min-width:0; }
.spacing-endpoint { color:var(--spacing-muted); font-size:11px; white-space:nowrap; }
.spacing-slider { appearance:none; -webkit-appearance:none; width:100%; min-width:0; height:28px; margin:0; padding:0; border:0; background:transparent; cursor:pointer; border-radius:6px; }
.spacing-slider::-webkit-slider-runnable-track { height:4px; border-radius:999px; background:linear-gradient(to right, #ec4141 0%, #ec4141 var(--spacing-fill), var(--spacing-track) var(--spacing-fill), var(--spacing-track) 100%); }
.spacing-slider::-moz-range-track { height:4px; border-radius:999px; background:var(--spacing-track); }
.spacing-slider::-moz-range-progress { height:4px; border-radius:999px; background:#ec4141; }
.spacing-slider::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; box-sizing:border-box; width:14px; height:14px; margin-top:-5px; border:1px solid rgb(15 23 42 / .08); border-radius:50%; background:#fff; box-shadow:0 1px 5px rgb(0 0 0 / .2); transition:box-shadow 150ms ease; }
.spacing-slider::-moz-range-thumb { box-sizing:border-box; width:14px; height:14px; border:1px solid rgb(15 23 42 / .08); border-radius:50%; background:#fff; box-shadow:0 1px 5px rgb(0 0 0 / .2); transition:box-shadow 150ms ease; }
.spacing-slider:hover::-webkit-slider-thumb, .spacing-slider:active::-webkit-slider-thumb { box-shadow:0 0 0 4px rgb(236 65 65 / .13), 0 1px 5px rgb(0 0 0 / .2); }
.spacing-slider:hover::-moz-range-thumb, .spacing-slider:active::-moz-range-thumb { box-shadow:0 0 0 4px rgb(236 65 65 / .13), 0 1px 5px rgb(0 0 0 / .2); }
.spacing-slider:focus-visible, .spacing-reset:focus-visible { outline:2px solid rgb(236 65 65 / .65); outline-offset:3px; }
.spacing-value { display:inline-flex; align-items:baseline; justify-content:center; gap:3px; min-width:52px; padding:6px 8px; border:1px solid rgb(128 128 128 / .14); border-radius:8px; background:rgb(128 128 128 / .06); font-size:13px; font-weight:500; font-variant-numeric:tabular-nums; }
.spacing-value span { color:var(--spacing-muted); font-size:10px; font-weight:400; }
.spacing-reset { display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:7px; color:var(--spacing-muted); transition:color 150ms, background-color 150ms; }
.spacing-reset:hover:not(:disabled) { background:rgb(236 65 65 / .08); color:#ec4141; }
.spacing-reset:disabled { opacity:.35; cursor:default; }
.editor-status { margin-top:8px; color:#ec4141; font-size:12px; }
.editor-menu { position:absolute; z-index:30; width:216px; max-width:calc(100% - 16px); padding:6px; background:#fff; border:1px solid rgb(128 128 128 / .2); border-radius:10px; box-shadow:0 12px 40px rgb(0 0 0 / .15); }
.menu-heading { display:flex; align-items:center; gap:8px; padding:6px 8px 10px; font-size:13px; }
.menu-heading>button { margin-left:auto; padding:4px; }
.menu-option { display:block; width:100%; padding:8px 12px; text-align:left; border-radius:5px; font-size:13px; }
.menu-option:hover { background:rgb(128 128 128 / .08); }
.dark .editor-menu { background:#242428; }
.dark :is(.editor-caption,.pool-title,.empty-pool) { color:#9ca3af; }
@media(max-width:760px) {
  .spacing-row { grid-template-columns:minmax(0, 1fr) auto auto; gap:10px 12px; }
  .spacing-label { grid-column:1; grid-row:1; }
  .spacing-value { grid-column:2; grid-row:1; }
  .spacing-reset { grid-column:3; grid-row:1; }
  .spacing-control { grid-column:1 / -1; grid-row:2; }
}
@media(prefers-reduced-motion:reduce) { .spacing-reset, .spacing-slider::-webkit-slider-thumb { transition:none; } .spacing-slider::-moz-range-thumb { transition:none; } }
@media(max-width:600px) { .editor-pools { grid-template-columns:1fr; } }
</style>
