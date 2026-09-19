import { describe, expect, it } from 'vitest';

import source from './TitleBar.vue?raw';

describe('TitleBar debounced real-time search', () => {
  it('auto-commits the draft after the input settles', () => {
    expect(source).toContain('const SEARCH_COMMIT_DELAY_MS = 250;');
    expect(source).toContain('searchCommitTimer = window.setTimeout');
    expect(source).toContain('setSearch(searchDraft.value)');
    expect(source).toContain('onBeforeUnmount(cancelPendingSearchCommit)');
  });

  it('keeps Enter, the search button, and clear as immediate commits', () => {
    expect(source).toContain('cancelPendingSearchCommit();');
    expect(source).toContain('@keydown.enter.prevent="commitSearch(searchDraft)"');
    expect(source).toContain('@click="commitSearch(searchDraft)"');
    expect(source).toContain("@click=\"commitSearch('')\"");
    expect(source).toContain('v-if="searchDraft || searchQuery"');
  });

  it('clears search and cancels the pending auto-commit on view change', () => {
    expect(source).toContain('[() => route.path, currentViewMode]');
    expect(source).toContain('commitSearch(\'\')');
  });
});
