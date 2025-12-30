import { ref } from 'vue';

export interface ToastMessage {
  id: number;
  text: string;
  type?: 'success' | 'error' | 'info';
}

const toasts = ref<ToastMessage[]>([]);
let nextId = 0;

export function useToast() {
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = nextId++;
    toasts.value.push({ id, text, type });
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }, 3000);
  };

  return {
    toasts,
    showToast
  };
}