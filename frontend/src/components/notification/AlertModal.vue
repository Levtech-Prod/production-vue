<script setup lang="ts">
import { useNotificationStore } from '../../stores/notificationStore';

const notificationStore = useNotificationStore();
</script>

<template>
  <Transition name="fade">
    <div
      v-if="notificationStore.modal.visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="mb-3 text-lg font-semibold text-gray-900">
          {{ notificationStore.modal.title }}
        </h3>

        <p class="mb-6 text-sm text-gray-600">
          {{ notificationStore.modal.message }}
        </p>

        <div class="flex justify-end">
          <button
            type="button"
            class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            @click="notificationStore.closeModal"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
