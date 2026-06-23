import { defineStore } from 'pinia';
import { ref } from 'vue';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

interface ModalState {
  visible: boolean;
  title: string;
  message: string;
}

export const useNotificationStore = defineStore('notification', () => {
  const toast = ref<ToastState>({
    visible: false,
    message: '',
    type: 'success',
  });

  const modal = ref<ModalState>({
    visible: false,
    title: '',
    message: '',
  });

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(
    message: string,
    type: ToastType = 'success',
    duration = 3000,
  ) {
    toast.value = {
      visible: true,
      message,
      type,
    };

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toast.value.visible = false;
    }, duration);
  }

  function showModal(title: string, message: string) {
    modal.value = {
      visible: true,
      title,
      message,
    };
  }

  function closeModal() {
    modal.value.visible = false;
  }

  return {
    toast,
    modal,
    showToast,
    showModal,
    closeModal,
  };
});
