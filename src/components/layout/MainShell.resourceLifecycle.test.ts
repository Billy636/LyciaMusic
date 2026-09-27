import { describe, expect, it } from 'vitest';
import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

import footerSource from './PlayerFooter.vue?raw';
import source from './MainShell.vue?raw';
import detailSource from '../player/PlayerDetail.vue?raw';

describe('MainShell heavy UI lifecycle', () => {
  it('keeps the player detail mounted because it owns the animated footer cover', () => {
    expect(source).toContain('<PlayerDetail />');
    expect(source).not.toContain('<PlayerDetail v-if=');
    expect(footerSource).toContain('data-footer-cover');
    expect(detailSource).toContain('<PlayerDetailLeft :isExpanded="showPlayerDetail" />');
  });

  it('mounts the remaining heavy overlays only while they are needed', () => {
    expect(source).toContain('v-if="!isMiniMode && isPlayQueueMounted"');
    expect(source).toContain('v-if="!isMiniMode && showAddToPlaylistModal"');
    expect(source).toContain('v-if="!isMiniMode && isSongInfoVisible"');
  });

  it('keeps the queue instance alive until its leave animation finishes', () => {
    expect(source).toContain('const PLAY_QUEUE_LEAVE_MS = 300;');
    expect(source).toContain('watch(showPlaylist');
  });

  it('uses route-aware transitions without remounting the music sidebar or changing the Home cache', () => {
    const { descriptor } = parse(source);
    const compiled = compileTemplate({
      source: descriptor.template!.content,
      filename: 'MainShell.vue',
      id: 'main-shell-settings-transition-test',
    });

    expect(compiled.errors).toEqual([]);
    expect(source).toContain('usePageTransition(() => route.path, skipNextPageTransition)');
    expect(source).toMatch(/<transition\b[^>]*:name="pageTransitionName"[^>]*mode="out-in"/);
    expect(source).toContain('<Sidebar />');
    expect(source).not.toContain('<Sidebar v-if=');
    expect(source).not.toContain('transition-[max-width,visibility]');
    expect(source).toContain('<KeepAlive include="Home">');
    expect(source).not.toMatch(/<KeepAlive\b[^>]*v-(?:if|else)/);
    expect(source).toContain(':key="route.meta.keepAlive ? String(route.name ?? route.path) : route.path"');
  });

  it('publishes the reactive sidebar width on the shell for the settings brand and sidebar', () => {
    const { descriptor } = parse(source);

    expect(descriptor.scriptSetup!.content).toMatch(/const\s*\{[^}]*\bsidebarWidth\b[^}]*\}\s*=\s*storeToRefs\(useUiStore\(\)\)/s);
    expect(descriptor.template!.content).toMatch(/^\s*<div\b[^>]*:style="\{\s*'--app-sidebar-width':\s*`\$\{sidebarWidth\}px`\s*\}"/);
  });

  it('keeps settings animations on route content so the header and player stay anchored', () => {
    const pageTransition = source.match(/<transition\b[^>]*:name="pageTransitionName"[^>]*>([\s\S]*?)<\/transition>/)?.[1];

    expect(pageTransition).toBeDefined();
    expect(pageTransition).toContain(':is="Component"');
    expect(pageTransition).not.toMatch(/TitleBar|Sidebar|PlayerFooter|GlobalBackground/);
  });

  it('changes sidebar occupancy and header layout together after the outgoing page leaves', () => {
    expect(source).toContain('usePageTransitionLayout(');
    expect(source).toContain('@after-leave="commitPageLayout"');
    expect(source).toContain('@before-enter="commitPageLayout"');
    expect(source).toContain('<TitleBar :settings-layout="isSettingsLayout" />');
    expect(source).toContain(":class=\"isSettingsLayout ? 'invisible' : ''\"");
    expect(source).toContain(':style="{ maxWidth: isSettingsLayout ? \'0px\' : `${SIDEBAR_MAX_WIDTH}px` }"');
  });

  it('uses a visible fade-slide with opposite entry and return directions', () => {
    const { descriptor } = parse(source);
    const style = descriptor.styles.map(block => block.content).join('\n');

    expect(compileStyle({ source: style, filename: 'MainShell.vue', id: 'main-shell-motion' }).errors).toEqual([]);
    expect(style).toMatch(/\.settings-forward-enter-from,\s*\.settings-back-leave-to\s*\{\s*opacity: 0;\s*transform: translate3d\(18px, 0, 0\);/);
    expect(style).toMatch(/\.settings-forward-leave-to,\s*\.settings-back-enter-from\s*\{\s*opacity: 0;\s*transform: translate3d\(-18px, 0, 0\);/);
    expect(style).toMatch(/\.settings-back-enter-active\s*\{[^}]*transition: opacity 0\.22s/);
    expect(style).toMatch(/\.settings-back-leave-active\s*\{[^}]*pointer-events: none;[^}]*transition: opacity 0\.12s/);
    expect(style).not.toContain('settings-reveal');
  });

  it('provides a reduced-motion alternative for settings entry and exit', () => {
    const { descriptor } = parse(source);
    const style = descriptor.styles.map(block => block.content).join('\n');
    const reducedMotion = style.slice(style.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reducedMotion).toMatch(/\.settings-forward-enter-active,[^}]*\.settings-back-leave-active\s*\{\s*transition: none;\s*will-change: auto;/);
    expect(reducedMotion).toMatch(/\.settings-forward-enter-from,[^}]*\.settings-back-leave-to\s*\{\s*transform: none;/);
  });
});
