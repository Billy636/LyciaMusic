import { ref } from 'vue';

const visible = ref(false);
const playlistId = ref<string | null>(null);
const initialFile = ref('');

export function usePlaylistImportDialog() {
  const open = (id: string | null = null, file = '') => {
    playlistId.value = id;
    initialFile.value = file;
    visible.value = true;
  };
  const close = () => { visible.value = false; };
  return { visible, playlistId, initialFile, open, close };
}
