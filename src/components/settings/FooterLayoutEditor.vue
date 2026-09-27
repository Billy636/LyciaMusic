<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { usePlaybackStore } from '../../features/playback/store';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import { footerAction } from '../../features/settings/footer';
import { footerButtonWidth, footerDropPosition, resolveFreeFooterLayout } from '../../features/settings/freeFooterLayout';
import type { FooterMovableId, FooterPlacement, FooterScene } from '../../types/footer';
import FooterIcon from '../layout/FooterIcon.vue';

const props = defineProps<{ scene: FooterScene }>();
defineEmits<{ reset: [] }>();
const { footer, setPlacement, setSpacing } = useFooterSettings();
const { currentSong, currentCover } = storeToRefs(usePlaybackStore());
const root = ref<HTMLElement | null>(null), bar = ref<HTMLElement | null>(null), menu = ref<HTMLElement | null>(null);
const width = ref(800);
const layout = computed(() => resolveFreeFooterLayout(footer.value, props.scene, width.value));
const behavior = computed(() => footer.value.behavior[props.scene]);
const spacing = computed(() => footer.value.spacing[footer.value.linked ? 'main' : props.scene]);
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
  setPlacement(props.scene, id, { visibility });
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
  const position = footerDropPosition(footer.value, props.scene, width.value, session.id, session.x - rect.left);
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
  setPlacement(props.scene, session.id, { visibility: target.visibility, ...(target.normalized !== undefined ? { x: target.normalized } : {}) });
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape' && (drag.value || menuId.value)) { event.preventDefault(); event.stopPropagation(); cancel(); closeMenu(true); return; }
  if (menuId.value || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]')?.dataset.editorAction as FooterMovableId;
  const item = layout.value.bar.find(item => item.id === id);
  if (!item) return;
  event.preventDefault(); event.stopPropagation();
  const target = footerDropPosition(footer.value, props.scene, width.value, id, item.x + (event.key === 'ArrowLeft' ? -8 : 8), false);
  if (target) setPlacement(props.scene, id, { visibility: 'bar', x: target.normalized });
}
function outside(event: PointerEvent) {
  if (menuId.value && !menu.value?.contains(event.target as Node) && !(event.target as Element).closest('[data-editor-action]')) closeMenu();
}
function interrupt() { cancel(); closeMenu(); }
watch(() => JSON.stringify([props.scene, footer.value.placement, footer.value.spacing, footer.value.behavior[props.scene]]), interrupt);
onMounted(() => {
  observer = new ResizeObserver(entries => { width.value = entries[0].contentRect.width; cancel(); });
  if (bar.value) observer.observe(bar.value);
  window.addEventListener('pointerdown', outside); window.addEventListener('blur', interrupt); window.addEventListener('resize', interrupt);
});
onBeforeUnmount(() => {
  cancel(); observer?.disconnect(); window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', interrupt); window.removeEventListener('resize', interrupt);
});
</script>

<template>
  <section ref="root" class="free-footer-editor" tabindex="-1" aria-label="直接摆放底栏按钮" @pointerdown="begin" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel" @click="click" @keydown="keyboard" @dragstart.prevent>
    <div class="editor-toolbar">
      <p class="editor-caption">按住按钮直接拖动，松手放下。点击按钮可隐藏或收入更多。</p>
      <button type="button" class="editor-reset" @click="$emit('reset')">恢复原版布局</button>
    </div>
    <div ref="bar" class="free-bar" :class="{ 'detail-scene': scene === 'detail', dragging: drag?.active }">
      <div v-if="behavior.progress !== 'hidden'" class="preview-progress"><span></span></div>
      <div v-if="behavior.info !== 'none'" class="preview-song" :style="{ width: `${layout.infoWidth}px` }">
        <img v-if="currentCover && behavior.info !== 'time'" :src="currentCover" alt="" draggable="false" />
        <div v-else-if="behavior.info === 'cover'" class="preview-cover-placeholder" aria-label="封面"></div>
        <span v-if="behavior.info !== 'cover'">{{ behavior.info === 'time' ? '01:28 / 04:06' : currentSong?.title || currentSong?.name || '歌曲信息' }}</span>
      </div>
      <button v-for="item in layout.bar" :key="item.id" type="button" class="preview-button" :class="{ 'play-control': item.id === 'play', moving: drag?.active && drag.id === item.id }"
        :style="{ left: `${item.x}px`, width: `${item.width}px`, height: `${item.width}px` }" :data-editor-action="item.id" :aria-label="`编辑${footerAction(item.id).label}`" :title="`${footerAction(item.id).label}：直接拖动或点击`">
        <FooterIcon :id="item.id" :pinned="!behavior.autoHide" :progress-hidden="behavior.progress === 'hidden'" />
      </button>
      <div v-if="drag?.active && drop?.visibility === 'bar'" class="drop-ghost" :class="{ 'play-control': drag.id === 'play' }" :style="{ left: `${drop.x}px`, width: `${footerButtonWidth(drag.id)}px`, height: `${footerButtonWidth(drag.id)}px` }" aria-hidden="true"><FooterIcon :id="drag.id" /></div>
    </div>
    <div class="editor-pools">
      <div v-for="pool in (['more', 'hidden'] as const)" :key="pool" class="editor-pool" :data-editor-pool="pool" :class="{ targeted: drag?.active && drop?.visibility === pool }">
        <div class="pool-title">{{ pool === 'more' ? '更多' : '已隐藏' }}</div>
        <div class="pool-items">
          <button v-for="item in layout[pool]" :key="item.id" type="button" class="pool-button" :data-editor-action="item.id" :aria-label="`编辑${footerAction(item.id).label}`"><FooterIcon :id="item.id" :pinned="!behavior.autoHide" :progress-hidden="behavior.progress === 'hidden'" /><span>{{ footerAction(item.id).label }}</span></button>
          <span v-if="!layout[pool].length" class="empty-pool">拖入按钮，或从这里拖回底栏</span>
        </div>
      </div>
    </div>
    <div class="spacing-row"><label>按钮最小间距 <output>{{ spacing.utilities }}px</output><input type="range" min="0" max="24" step="1" :value="spacing.utilities" @input="setSpacing(scene, { utilities: Number(($event.target as HTMLInputElement).value) })" /></label><button type="button" class="editor-reset" @click="setSpacing(scene, { controls: 24, utilities: 8 })">恢复原版间距</button></div>
    <p v-if="dragHint" class="editor-status" role="status" aria-live="polite">{{ dragHint }}</p>
    <div v-if="menuId" ref="menu" class="editor-menu" :style="{ left: `${menuLeft}px`, top: `${menuTop}px` }" :aria-label="`${footerAction(menuId).label}选项`" @pointerdown.stop>
      <div class="menu-heading"><FooterIcon :id="menuId" /><span>{{ footerAction(menuId).label }}</span><button type="button" aria-label="关闭按钮选项" @click.stop="closeMenu(true)"><X class="h-4 w-4" /></button></div>
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
.preview-progress { position:absolute; top:0; left:16px; right:16px; height:2px; background:rgb(128 128 128 / .15); }
.preview-progress>span { display:block; height:100%; width:36%; background:#ec4141; }
.preview-song { position:absolute; left:16px; top:50%; transform:translateY(-50%); display:flex; gap:8px; align-items:center; min-width:0; font-size:12px; color:#6b7280; }
.preview-song img { width:36px; height:36px; border-radius:6px; flex-shrink:0; }
.preview-cover-placeholder { width:36px; height:36px; border-radius:6px; flex-shrink:0; background:rgb(128 128 128 / .12); }
.preview-song span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.preview-button,.drop-ghost { position:absolute; top:50%; transform:translate(-50%,-50%); display:flex; align-items:center; justify-content:center; border-radius:6px; }
.preview-button { cursor:grab; touch-action:none; }
.preview-button:hover { background:rgb(236 65 65 / .07); }
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
.spacing-row { display:flex; gap:20px; flex-wrap:wrap; align-items:center; margin-top:20px; }
.spacing-row label { flex:1; min-width:180px; font-size:12px; }
.spacing-row output { float:right; font-variant-numeric:tabular-nums; }
.spacing-row input { display:block; width:100%; accent-color:#ec4141; margin-top:10px; }
.editor-status { margin-top:8px; color:#ec4141; font-size:12px; }
.editor-menu { position:absolute; z-index:30; width:216px; max-width:calc(100% - 16px); padding:6px; background:#fff; border:1px solid rgb(128 128 128 / .2); border-radius:10px; box-shadow:0 12px 40px rgb(0 0 0 / .15); }
.menu-heading { display:flex; align-items:center; gap:8px; padding:6px 8px 10px; font-size:13px; }
.menu-heading>button { margin-left:auto; padding:4px; }
.menu-option { display:block; width:100%; padding:8px 12px; text-align:left; border-radius:5px; font-size:13px; }
.menu-option:hover { background:rgb(128 128 128 / .08); }
:global(.dark) .editor-menu { background:#242428; }
:global(.dark) :is(.editor-caption,.preview-song,.pool-title,.empty-pool) { color:#9ca3af; }
@media(max-width:600px) { .editor-pools { grid-template-columns:1fr; } }
</style>
