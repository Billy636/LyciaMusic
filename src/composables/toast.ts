import { ref } from 'vue';

export interface ToastMessage {
  id: number;
  text: string;
  type?: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}

const toasts = ref<ToastMessage[]>([]);
let nextId = 0;

export function useToast() {
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info', action?: ToastMessage['action']) => {
    const id = nextId++;
    toasts.value.push({ id, text, type, action: action && {
      label: action.label,
      onClick: () => {
        toasts.value = toasts.value.filter(t => t.id !== id);
        action.onClick();
      },
    } });
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }, action ? 6000 : 3000);
  };

  return {
    toasts,
    showToast
  };
}
