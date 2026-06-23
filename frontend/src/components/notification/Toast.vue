<script setup lang="ts">
import { computed } from 'vue';
import { useNotificationStore } from '../../stores/notificationStore';

const notificationStore = useNotificationStore();

const toastClass = computed(() => {
  switch (notificationStore.toast.type) {
    case 'success':
      return 'bg-green-600 text-white';
    case 'error':
      return 'bg-red-600 text-white';
    case 'info':
      return 'bg-blue-600 text-white';
    default:
      return 'bg-gray-800 text-white';
  }
});
</script>

<template>
  <Transition name="fade">
    <div
      v-if="notificationStore.toast.visible"
      class="fixed right-6 top-6 z-50 rounded-lg px-5 py-3 text-sm shadow-lg"
      :class="toastClass"
    >
      {{ notificationStore.toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
