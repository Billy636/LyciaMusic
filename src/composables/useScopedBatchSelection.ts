import { ref, watch, type Ref } from 'vue';

export function useScopedBatchSelection(scopeKey: Ref<string>) {
  const isBatchMode = ref(false);
  const selectedPaths = ref<Set<string>>(new Set());

  const clearSelection = () => {
    selectedPaths.value = new Set();
  };

  watch(isBatchMode, value => {
    if (!value) {
      clearSelection();
    }
  }, { flush: 'sync' });

  watch(scopeKey, () => {
    isBatchMode.value = false;
    clearSelection();
  }, { flush: 'sync' });

  return {
    isBatchMode,
    selectedPaths,
    clearSelection,
  };
}
