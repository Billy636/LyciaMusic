import { describe, expect, it } from 'vitest';

import source from './TitleBar.vue?raw';

describe('TitleBar explicit search submission', () => {
  it('keeps a draft until Enter or the search button submits it', () => {
    expect(source).toContain('searchDraft.value = value');
    expect(source).toContain('@keydown.enter.prevent="commitSearch(searchDraft)"');
    expect(source).toContain('@click="commitSearch(searchDraft)"');
    expect(source).toContain("@click=\"commitSearch('')\"");
    expect(source).toContain('v-if="searchDraft || searchQuery"');
    expect(source).not.toContain('SEARCH_COMMIT_DELAY_MS');
  });
});
