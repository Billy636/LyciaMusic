<script setup lang="ts">
import { computed, nextTick, onDeactivated, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, MoveHorizontal, RotateCcw, X } from 'lucide-vue-next';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import { footerAction } from '../../features/settings/footer';
import { footerAlignedPositions, footerButtonWidth, footerDropPosition, resolveFreeFooterLayout, type FooterAlignment, type FooterDropGuides } from '../../features/settings/freeFooterLayout';
import type { FooterMovableId, FooterPlacement, FooterScene } from '../../types/footer';
import FooterIcon from '../layout/FooterIcon.vue';
import FooterActionButton from '../layout/FooterActionButton.vue';
import FooterSongInfo from '../layout/FooterSongInfo.vue';
import SettingsNumberControl from './SettingsNumberControl.vue';
import { footerViewport, footerLivePresentation as live } from '../layout/footerPresentation';

const props = defineProps<{ scene: FooterScene }>();
defineEmits<{ reset: [] }>();
const { footer, setPlacement, setSpacing, alignButtons } = useFooterSettings();
const root = ref<HTMLElement | null>(null), bar = ref<HTMLElement | null>(null), menu = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const previewWidth = ref(800);
const width = computed(() => footerViewport.value.width || previewWidth.value);
const previewScale = computed(() => Math.min(1, previewWidth.value / Math.max(1, width.value)));
const layout = computed(() => resolveFreeFooterLayout(footer.value, props.scene, width.value));
const behavior = computed(() => footer.value.behavior[props.scene]);
const spacing = computed(() => footer.value.spacing[footer.value.linked ? 'main' : props.scene]);
const spacingControls = [
  { key: 'controls', label: '播放按钮间距', min: 8, max: 40, default: 24, hint: '仅调整上一首、播放/暂停、下一首之间的间距' },
  { key: 'utilities', label: '功能按钮间距', min: 0, max: 24, default: 8, hint: '调整播放模式、播放队列、音量、歌词、均衡器等功能按钮的间距' },
] as const;
function setSpacingValue(key: 'controls' | 'utilities', value: number) {
  setSpacing(props.scene, { [key]: value }, width.value);
}
const previewIconProps = (id: FooterMovableId) => ({
  id: (id === 'play' && live.value.playing ? 'pause' : id) as FooterMovableId | 'pause',
  active: live.value.active[id], playMode: live.value.playMode, volume: live.value.volume,
  pinned: !behavior.value.autoHide, progressHidden: behavior.value.progress === 'hidden',
});
const menuId = ref<FooterMovableId | null>(null);
const menuLeft = ref(0), menuTop = ref(0);
let menuAnchor: HTMLElement | null = null;
const alignmentControl = ref<HTMLElement | null>(null);
const alignmentTrigger = ref<HTMLButtonElement | null>(null);
const alignmentMenu = ref<HTMLElement | null>(null);
const showAlignmentMenu = ref(false);
const alignmentMenuId = useId();
const alignmentOptions = computed(() => ([
  { value: 'playback-center', label: '播放组居中', icon: AlignHorizontalJustifyCenter, hint: '播放键居中，两侧按播放间距排列' },
  { value: 'utilities-right', label: '功能组靠右', icon: AlignHorizontalJustifyEnd, hint: '保留现有顺序，按功能间距排列' },
] as const).map(option => ({ ...option,
  available: footerAlignedPositions(footer.value, props.scene, width.value, option.value) !== null,
})));

function closeAlignmentMenu(restore = false) {
  showAlignmentMenu.value = false;
  if (restore) alignmentTrigger.value?.focus({ preventScroll: true });
}
async function toggleAlignmentMenu() {
  closeMenu(); cancel();
  showAlignmentMenu.value = !showAlignmentMenu.value;
  if (showAlignmentMenu.value) {
    await nextTick();
    alignmentMenu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }
}
function chooseAlignment(alignment: FooterAlignment) {
  alignButtons(props.scene, alignment, width.value);
  closeAlignmentMenu(true);
}
function alignmentKeyboard(event: KeyboardEvent) {
  if (!showAlignmentMenu.value) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAlignmentMenu(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const buttons = Array.from(alignmentMenu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
}
type Drop = { visibility: 'bar' | 'more' | 'hidden'; x?: number; normalized?: number; guides?: FooterDropGuides };
const drop = ref<Drop | null>(null);
const drag = ref<{ id: FooterMovableId; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean; anchor: HTMLElement } | null>(null);
let observer: ResizeObserver | undefined;
const allIds = computed(() => [...layout.value.bar, ...layout.value.more, ...layout.value.hidden].map(item => item.id));
const guideAxis = computed(() => drop.value?.guides?.symmetry ?? drop.value?.guides?.center);
const guideAxisLabel = computed(() => {
  const guides = drop.value?.guides;
  if (guides?.symmetry === undefined) return '居中';
  return guides.center !== undefined && Math.abs(guides.center - guides.symmetry) < .01 ? '居中 · 对称' : '对称';
});

function closeMenu(restore = false) {
  menuId.value = null;
  if (restore) void nextTick(() => (menuAnchor?.isConnected ? menuAnchor : root.value)?.focus({ preventScroll: true }));
}
async function openMenu(id: FooterMovableId, anchor: HTMLElement) {
  closeAlignmentMenu();
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
  event.preventDefault(); event.stopPropagation(); closeMenu(); closeAlignmentMenu(); button.focus({ preventScroll: true });
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
  const position = footerDropPosition(footer.value, props.scene, width.value, session.id, (session.x - rect.left) / previewScale.value, true, 8 / previewScale.value);
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
function outside(event: Event) {
  if (showAlignmentMenu.value && !alignmentControl.value?.contains(event.target as Node)) closeAlignmentMenu();
  if (menuId.value && !menu.value?.contains(event.target as Node) && !(event.target as Element).closest('[data-editor-action]')) closeMenu();
}
function interrupt() { cancel(); closeMenu(); closeAlignmentMenu(); }
watch(() => JSON.stringify([props.scene, footer.value.placement, footer.value.spacing, footer.value.behavior[props.scene]]), interrupt);
watch(width, cancel);
onDeactivated(interrupt);
onMounted(() => {
  observer = new ResizeObserver(entries => { previewWidth.value = entries[0].contentRect.width; cancel(); });
  if (viewport.value) observer.observe(viewport.value);
  window.addEventListener('pointerdown', outside); window.addEventListener('focusin', outside); window.addEventListener('blur', interrupt); window.addEventListener('resize', interrupt);
});
onBeforeUnmount(() => {
  cancel(); observer?.disconnect(); window.removeEventListener('pointerdown', outside); window.removeEventListener('focusin', outside); window.removeEventListener('blur', interrupt); window.removeEventListener('resize', interrupt);
});
</script>

<template>
  <section ref="root" class="free-footer-editor" tabindex="-1" aria-label="直接摆放底栏按钮" @pointerdown="begin" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel" @click="click" @keydown="keyboard" @dragstart.prevent>
    <div class="editor-toolbar">
      <p class="editor-caption">拖动调整位置</p>
      <div class="editor-toolbar-actions">
        <div ref="alignmentControl" class="alignment-control" @keydown="alignmentKeyboard">
          <button ref="alignmentTrigger" type="button" class="alignment-trigger" :class="{ 'is-open': showAlignmentMenu }"
            title="对齐" aria-label="对齐" aria-haspopup="menu" :aria-expanded="showAlignmentMenu" :aria-controls="alignmentMenuId" @click="toggleAlignmentMenu">
            <AlignHorizontalJustifyCenter class="h-4 w-4" aria-hidden="true" />
          </button>
          <div v-if="showAlignmentMenu" :id="alignmentMenuId" ref="alignmentMenu" class="alignment-menu" role="menu" aria-label="底栏对齐">
            <button v-for="option in alignmentOptions" :key="option.value" type="button" role="menuitem" :disabled="!option.available"
              :title="option.available ? option.hint : '没有可对齐的按钮，或目标位置被占用；请先移动附近按钮腾出空间'" @click="chooseAlignment(option.value)">
              <component :is="option.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span><span class="alignment-menu-label">{{ option.label }}</span><span class="alignment-menu-hint">{{ option.available ? option.hint : '无可用按钮或对齐空间不足' }}</span></span>
            </button>
          </div>
        </div>
        <button type="button" class="editor-reset" title="恢复原版布局" aria-label="恢复原版布局" @click="$emit('reset')">
          <RotateCcw :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div ref="viewport" class="free-bar" :class="{ 'detail-scene': live.expanded, dragging: drag?.active }"
      :style="{ height: `${footerViewport.height * previewScale + 24}px` }">
      <div ref="bar" class="preview-canvas" :class="live.expanded ? 'text-white' : 'text-gray-800 dark:text-white'"
        :style="{ width: `${width}px`, height: `${footerViewport.height}px`, transform: `translateX(-50%) scale(${previewScale})` }">
      <div v-if="behavior.progress !== 'hidden'" class="preview-progress" :class="{ 'hover-only': behavior.progress === 'hover' }"><div class="preview-progress-track"><span :style="{ width: `${live.progress}%`, backgroundColor: behavior.progressColor || 'rgb(212 212 216 / .3)' }"></span></div></div>
      <div class="preview-song" :style="{ width: `${layout.infoWidth}px` }">
        <FooterSongInfo preview :mode="behavior.info" :width="layout.infoWidth" :song="live.song" :cover="live.cover" :expanded="live.expanded" :cover-shape="footer.coverShape[scene]"
          :current-time="live.currentTime" :total-time="live.totalTime" :download-label="live.downloadLabel" />
      </div>
      <FooterActionButton v-for="item in layout.bar" :key="item.id" :id="item.id" editing class="preview-button" :class="{ moving: drag?.active && drag.id === item.id }"
        :style="{ left: `${item.x}px`, width: `${item.width}px`, height: `${item.width}px` }" :data-editor-action="item.id" :label="`编辑${footerAction(item.id).label}`"
        :active="live.active[item.id]" :playing="live.playing" :play-mode="live.playMode" :volume="live.volume" :pinned="!behavior.autoHide" :progress-hidden="behavior.progress === 'hidden'"
        @activate="event => { if (event.detail === 0) openMenu(item.id, event.currentTarget as HTMLElement); }" />
      <div v-if="drag?.active && guideAxis !== undefined" class="alignment-center-guide" :style="{ left: `${guideAxis}px` }" aria-hidden="true"><span>{{ guideAxisLabel }}</span></div>
      <template v-if="drag?.active && drop?.guides?.gaps">
        <div v-for="(span, index) in drop.guides.gaps.spans" :key="index" class="alignment-gap-guide" :style="{ left: `${span.from}px`, width: `${Math.max(0, span.to - span.from)}px` }" aria-hidden="true">
        </div>
        <span v-if="guideAxis === undefined" class="alignment-gap-label" :style="{ left: `${drop.x}px` }" aria-hidden="true">等间距</span>
      </template>
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
      <div class="spacing-label">
        <span class="spacing-icon"><MoveHorizontal class="h-4 w-4" aria-hidden="true" /></span>
        <span>{{ control.label }}</span>
      </div>
      <SettingsNumberControl class="spacing-control" :model-value="spacing[control.key]"
        :min="control.min" :max="control.max" :step="1" unit="px" :default-value="control.default"
        :label="control.label" @update:model-value="setSpacingValue(control.key, $event)" />
    </div>
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
.editor-toolbar-actions { display:flex; align-items:center; gap:8px; }
.alignment-control { position:relative; }
.alignment-trigger { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:6px; color:var(--app-text-secondary); }
.alignment-trigger:hover,.alignment-trigger.is-open { color:#ec4141; background:var(--hover-surface); }
.alignment-menu { position:absolute; z-index:80; right:0; top:calc(100% + 8px); width:256px; max-width:calc(100vw - 32px); padding:5px; border:1px solid rgb(148 163 184 / .2); border-radius:10px; background:rgb(255 255 255 / .92); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); box-shadow:0 12px 32px rgb(0 0 0 / .15); }
.dark .alignment-menu { background:rgb(24 32 40 / .92); border-color:rgb(255 255 255 / .12); }
.alignment-menu>button { display:flex; align-items:center; gap:10px; width:100%; padding:10px; border-radius:6px; text-align:left; }
.alignment-menu>button:hover:not(:disabled) { background:var(--hover-surface); }
.alignment-menu>button:disabled { opacity:.55; cursor:not-allowed; }
.alignment-menu-label { display:block; font-size:13px; }
.alignment-menu-hint { display:block; margin-top:3px; font-size:11px; color:var(--app-text-secondary); }
.alignment-trigger:focus-visible,.alignment-menu button:focus-visible { outline:2px solid rgb(236 65 65 / .6); outline-offset:2px; }
.alignment-center-guide { position:absolute; top:4px; bottom:4px; width:0; border-left:1px dashed #ec4141; pointer-events:none; color:#ec4141; }
.alignment-center-guide>span { position:absolute; top:-6px; left:5px; font-size:10px; white-space:nowrap; }
.alignment-gap-guide { position:absolute; top:calc(50% + 27px); height:1px; background:#ec4141; color:#ec4141; pointer-events:none; }
.alignment-gap-guide::before,.alignment-gap-guide::after { content:''; position:absolute; top:-3px; width:1px; height:7px; background:currentColor; }
.alignment-gap-guide::before { left:0; } .alignment-gap-guide::after { right:0; }
.alignment-gap-label { position:absolute; top:calc(50% + 32px); transform:translateX(-50%); color:#ec4141; font-size:10px; white-space:nowrap; pointer-events:none; }
.editor-caption { margin:0; font-size:13px; color:var(--app-text-secondary); }
/* 与数值控件的恢复按钮一致：常态淡出、悬停只出系统文字提示，不做高亮/变色。 */
.editor-reset { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; width:28px; height:28px; padding:0; border:0; border-radius:6px; color:var(--app-text-secondary); opacity:.3; }
.editor-reset:focus-visible { outline:2px solid #ec4141; outline-offset:2px; opacity:1; }
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
.pool-title { font-size:12px; color:var(--app-text-secondary); margin-bottom:8px; }
.pool-items { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-height:32px; }
.pool-button { display:flex; align-items:center; gap:8px; padding:5px 8px; font-size:12px; border-radius:6px; cursor:grab; touch-action:none; }
.pool-button:hover { background:var(--hover-surface); }
.empty-pool { color:var(--app-text-muted); font-size:11px; }
.targeted { outline:2px solid #ec4141; }
.spacing-row {
  display:grid;
  grid-template-columns:minmax(144px, 1fr) minmax(220px, 420px);
  gap:16px;
  align-items:center;
  margin-top:18px;
  padding:10px 0;
}
.spacing-label { display:flex; align-items:center; gap:10px; font-size:13px; font-weight:500; }
.spacing-icon { display:flex; align-items:center; justify-content:center; width:20px; height:28px; flex-shrink:0; color:#ec4141; }
.dark .spacing-icon { color:#ff8b8b; }
.spacing-control { min-width:0; }
.editor-menu { position:absolute; z-index:30; width:216px; max-width:calc(100% - 16px); padding:6px; background:#fff; border:1px solid rgb(128 128 128 / .2); border-radius:10px; box-shadow:0 12px 40px rgb(0 0 0 / .15); }
.menu-heading { display:flex; align-items:center; gap:8px; padding:6px 8px 10px; font-size:13px; }
.menu-heading>button { margin-left:auto; padding:4px; }
.menu-option { display:block; width:100%; padding:8px 12px; text-align:left; border-radius:5px; font-size:13px; }
.menu-option:hover { background:var(--hover-surface); }
.dark .editor-menu { background:#242428; }
@media(max-width:760px) {
  .spacing-row { grid-template-columns:minmax(0, 1fr); gap:8px 12px; }
}
@media(max-width:600px) { .editor-pools { grid-template-columns:1fr; } }
</style>
