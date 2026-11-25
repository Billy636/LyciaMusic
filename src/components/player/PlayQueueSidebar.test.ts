import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

import source from './PlayQueueSidebar.vue?raw';

describe('PlayQueueSidebar shared player panel', () => {
  it('uses the shared right-drawer geometry and transition without the old card sizing', () => {
    expect(source).toContain("import './playerSidePanel.css'");
    expect(source).toContain('class="player-side-panel player-side-panel--right pointer-events-auto"');
    expect(source).toContain('<transition name="player-side-panel" appear>');
    expect(source).not.toContain('player-side-panel--solid-backdrop');
    expect(source).not.toContain('slide-right');
    expect(source).not.toContain('w-[340px]');
    expect(source).not.toContain('calc(100vh -');
    expect(source).not.toContain('useThemeSettings');
  });

  it('shares header typography and actions while keeping count, clear, and close controls', () => {
    expect(source).toContain('class="player-side-panel__header"');
    expect(source).toContain('class="player-side-panel__eyebrow">QUEUE');
    expect(source).toContain('class="player-side-panel__title">播放队列');
    expect(source).toContain('{{ playQueuePaths.length }}');
    expect(source).toContain('class="player-side-panel__action');
    expect(source).toContain('class="player-side-panel__icon-button"');
    expect(source).toContain('aria-label="关闭播放队列" @click="togglePlaylist"');
    expect(source).toContain('aria-labelledby="play-queue-sidebar-title"');
  });

  it('aligns with the left drawer without an obscuring backdrop mask, using click-outside and shared panel surface', () => {
    expect(source).not.toContain('bg-black/15');
    expect(source).not.toContain('backdrop-blur');
    expect(source).not.toContain('fixed inset-0');
    expect(source).toContain('@click.stop');
    expect(source).toContain('@mousedown.stop');
    expect(source).toContain("window.addEventListener('mousedown', handleClickOutside);");
    expect(source).toContain("window.removeEventListener('mousedown', handleClickOutside);");
  });

  it('uses translucent white queue rows and secondary text instead of opaque light cards', () => {
    expect(source).toContain("'border-white/25 bg-white/14 text-white'");
    expect(source).toContain('text-white/45');
    expect(source).toContain('text-white/40');
    expect(source).toContain('bg-[#EC4141] animate-music-bar-1');
    expect(source).toContain('isRemoteSong(song)');
    expect(source).toContain('播放队列为空');
    expect(source).not.toContain('dark:');
    expect(source).not.toContain('bg-[#f7f9fc]');
    expect(source).not.toContain('bg-[#eef3f8]');
  });

  it('preserves the 69px virtual row height, paging, and scroll contracts', () => {
    expect(source).toContain('const QUEUE_ROW_HEIGHT = 69;');
    expect(source).toContain('const QUEUE_OVERSCAN = 10;');
    expect(source).toContain('paddingTop: renderStart * QUEUE_ROW_HEIGHT');
    expect(source).toContain('paddingBottom: (total - renderEnd) * QUEUE_ROW_HEIGHT');
    expect(source).toContain('playQueuePaths.value.slice(renderStart, renderEnd)');
    expect(source).toContain('rowHeight: QUEUE_ROW_HEIGHT');
    expect(source).toContain(':style="{ height: `${QUEUE_ROW_HEIGHT}px` }"');
    expect(source).toContain('class="player-side-panel__scroll custom-scrollbar p-3" @scroll="handleQueueScroll"');
    expect(source).toContain('currentIndex * QUEUE_ROW_HEIGHT - containerHeight.value / 2');
  });

  it('keeps play, remove, and clear confirmation wired to the existing actions', () => {
    expect(source).toContain('const song = await loadSong(path);');
    expect(source).toContain('await playSong(song, { preserveQueue: true });');
    expect(source).toContain('@click="handlePlayPath(song.path)"');
    expect(source).toContain('e.stopPropagation();\n  removeSongFromQueue(song);');
    expect(source).toContain('@click="handleRemove(song, $event)"');
    const clearButtonAction = /const handleClearClick = \(\) => \{([\s\S]*?)\};/.exec(source)?.[1];
    expect(clearButtonAction).toContain('showClearModal.value = true;');
    expect(clearButtonAction).not.toContain('clearQueue()');
    expect(source).toContain('clearQueue();\n  showClearModal.value = false;');
    expect(source).toContain('v-model:visible="showClearModal"');
    expect(source).toContain('@confirm="confirmClear"');
    expect(source).toContain('此操作不会影响本地文件');
  });

  it('handles Escape in the bubble phase only when the queue owns it, leaving confirmation first', () => {
    expect(source).toContain('data-shortcut-capture="true"');
    expect(source).toContain("if (event.key !== 'Escape' || event.defaultPrevented || !showPlaylist.value || showClearModal.value) return;");
    expect(source).toContain('event.preventDefault();\n  event.stopPropagation();\n  togglePlaylist();');
    expect(source).toContain("window.addEventListener('keydown', handleQueueKeydown);");
    expect(source).toContain("window.removeEventListener('keydown', handleQueueKeydown);");
    expect(source).not.toContain("addEventListener('keydown', handleQueueKeydown, true)");
    expect(source).toContain("window.removeEventListener('resize', updateContainerHeight);");
  });

  it('compiles the script and complete teleported template', () => {
    const { descriptor } = parse(source);
    expect(() => compileScript(descriptor, { id: 'play-queue-sidebar' })).not.toThrow();
    const result = compileTemplate({
      source: descriptor.template!.content,
      filename: 'PlayQueueSidebar.vue',
      id: 'play-queue-sidebar',
    });
    expect(result.errors).toEqual([]);
  });
});
