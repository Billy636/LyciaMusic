import { compileTemplate, parse } from '@vue/compiler-sfc';
import { createPinia, setActivePinia, storeToRefs } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import sidebarSource from '../../components/layout/Sidebar.vue?raw';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useUiStore } from './ui';

describe('shared sidebar layout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('preserves the music sidebar default and resize limits', () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(192);
    expect(SIDEBAR_MAX_WIDTH).toBe(360);
    expect(useUiStore().sidebarWidth).toBe(192);
  });

  it.each([192, 208, 240, 287.5, 344, 360])('shares an in-range resize to %s pixels', (width) => {
    const store = useUiStore();
    const { sidebarWidth } = storeToRefs(store);
    store.setSidebarWidth(width);

    expect(store.sidebarWidth).toBe(width);
    expect(sidebarWidth.value).toBe(width);
  });

  it.each([
    [-200, SIDEBAR_MIN_WIDTH],
    [0, SIDEBAR_MIN_WIDTH],
    [191, SIDEBAR_MIN_WIDTH],
    [361, SIDEBAR_MAX_WIDTH],
    [10000, SIDEBAR_MAX_WIDTH],
  ])('clamps %s pixels to %s', (requested, expected) => {
    const store = useUiStore();
    store.setSidebarWidth(requested);

    expect(store.sidebarWidth).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity])('ignores non-finite width %s without losing the current layout', (width) => {
    const store = useUiStore();
    store.setSidebarWidth(256);
    store.setSidebarWidth(width);

    expect(store.sidebarWidth).toBe(256);
  });

  it('shares width between consumers in the same app and isolates separate app instances', () => {
    const app = createPinia();
    const musicSidebar = useUiStore(app);
    const settingsSidebar = useUiStore(app);
    const separateApp = useUiStore(createPinia());

    musicSidebar.setSidebarWidth(304);

    expect(settingsSidebar.sidebarWidth).toBe(304);
    expect(separateApp.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    settingsSidebar.setSidebarWidth(224);
    expect(musicSidebar.sidebarWidth).toBe(224);
  });

  it('uses shared width for both pointer and keyboard sidebar resizing', () => {
    expect(sidebarSource).toContain('const { sidebarWidth } = storeToRefs(uiStore)');
    expect(sidebarSource).toContain('const { setSidebarWidth } = uiStore');
    expect(sidebarSource).toMatch(/setSidebarWidth\(\s*resizeStartWidth \+ event\.clientX - resizeStartX,\s*\)/);
    expect(sidebarSource).toContain('setSidebarWidth(sidebarWidth.value + delta)');
    expect(sidebarSource).toContain('const SIDEBAR_KEYBOARD_STEP = 16');
    expect(sidebarSource).not.toContain('const sidebarWidth = ref(');
    expect(sidebarSource).not.toContain('clampSidebarWidth');
  });

  it('preserves resize handle accessibility and drag cleanup', () => {
    const { descriptor } = parse(sidebarSource);
    const compiled = compileTemplate({
      source: descriptor.template!.content,
      filename: 'Sidebar.vue',
      id: 'sidebar-layout-test',
    });

    expect(compiled.errors).toEqual([]);
    expect(sidebarSource).toContain(':style="{ width: `${sidebarWidth}px` }"');
    expect(sidebarSource).toContain('role="separator"');
    expect(sidebarSource).toContain(':aria-valuemin="SIDEBAR_MIN_WIDTH"');
    expect(sidebarSource).toContain(':aria-valuemax="SIDEBAR_MAX_WIDTH"');
    expect(sidebarSource).toContain(':aria-valuenow="sidebarWidth"');
    expect(sidebarSource).toContain('@keydown.left.prevent="resizeSidebarBy(-SIDEBAR_KEYBOARD_STEP)"');
    expect(sidebarSource).toContain('@keydown.right.prevent="resizeSidebarBy(SIDEBAR_KEYBOARD_STEP)"');
    expect(sidebarSource).toContain("window.removeEventListener('pointermove', handleSidebarResize)");
    expect(sidebarSource).toContain("window.removeEventListener('pointerup', stopSidebarResize)");
    expect(sidebarSource).toContain("window.removeEventListener('pointercancel', stopSidebarResize)");
    expect(sidebarSource).toContain('onBeforeUnmount(stopSidebarResize)');
  });
});
