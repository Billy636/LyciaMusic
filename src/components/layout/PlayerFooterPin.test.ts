import { describe, expect, it } from 'vitest';
import footerSource from './PlayerFooter.vue?raw';

describe('PlayerFooter pin state decoupling', () => {
  it('defines independent storage keys for main shell and lyric detail page', () => {
    expect(footerSource).toContain('footer_pinned_main');
    expect(footerSource).toContain('footer_pinned_detail');
    expect(footerSource).toContain('isPinnedMain');
    expect(footerSource).toContain('isPinnedDetail');
  });

  it('switches effective isPinned state based on showPlayerDetail', () => {
    expect(footerSource).toContain('const isPinned = computed(() => (');
    expect(footerSource).toContain('showPlayerDetail.value ? isPinnedDetail.value : isPinnedMain.value');
  });

  it('updates separate pin states in togglePin depending on showPlayerDetail', () => {
    expect(footerSource).toContain('if (showPlayerDetail.value) {');
    expect(footerSource).toContain('isPinnedDetail.value = !isPinnedDetail.value;');
    expect(footerSource).toContain("localStorage.setItem('footer_pinned_detail'");
    expect(footerSource).toContain('isPinnedMain.value = !isPinnedMain.value;');
    expect(footerSource).toContain("localStorage.setItem('footer_pinned_main'");
  });
});
