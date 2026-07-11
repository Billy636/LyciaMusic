import { describe, expect, it } from 'vitest';

import source from './TitleBar.vue?raw';

describe('TitleBar search request pacing', () => {
  it('debounces non-empty queries while keeping clear immediate', () => {
    expect(source).toContain('SEARCH_COMMIT_DELAY_MS = 150');
    expect(source).toContain('searchDraft.value = value');
    expect(source).toContain('searchCommitTimer = window.setTimeout');
    expect(source).toContain("if (!value) {");
    expect(source).toContain("setSearch('');");
    expect(source).toContain("@click=\"commitSearch('')\"");
  });
});
