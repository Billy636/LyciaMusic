import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { useScopedBatchSelection } from './useScopedBatchSelection';

describe('useScopedBatchSelection', () => {
  it('clears selected paths when batch mode is turned off', async () => {
    const scopeKey = ref('home::folder::/music/live');
    const scope = effectScope();

    let selection!: ReturnType<typeof useScopedBatchSelection>;
    scope.run(() => {
      selection = useScopedBatchSelection(scopeKey);
    });

    selection.isBatchMode.value = true;
    selection.selectedPaths.value = new Set(['a.flac', 'b.flac']);
    selection.isBatchMode.value = false;

    await nextTick();

    expect(selection.selectedPaths.value.size).toBe(0);

    scope.stop();
  });

  it('exits batch mode and clears selected paths when the selection scope changes', async () => {
    const scopeKey = ref('home::folder::/music/live');
    const scope = effectScope();

    let selection!: ReturnType<typeof useScopedBatchSelection>;
    scope.run(() => {
      selection = useScopedBatchSelection(scopeKey);
    });

    selection.isBatchMode.value = true;
    selection.selectedPaths.value = new Set(['folder-song.flac']);

    scopeKey.value = 'home::all';
    await nextTick();

    expect(selection.isBatchMode.value).toBe(false);
    expect(selection.selectedPaths.value.size).toBe(0);

    scope.stop();
  });
});
