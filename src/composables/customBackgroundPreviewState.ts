import { readonly, ref } from 'vue';

const isCustomBackgroundPreviewOpen = ref(false);

export function useCustomBackgroundPreviewState() {
  return {
    isCustomBackgroundPreviewOpen: readonly(isCustomBackgroundPreviewOpen),
    setCustomBackgroundPreviewOpen: (open: boolean) => {
      isCustomBackgroundPreviewOpen.value = open;
    },
  };
}
