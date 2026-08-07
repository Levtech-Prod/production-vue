<script setup lang="ts">
import { useNotificationStore } from '../../stores/notificationStore';
import { OVERLAY_LAYERS } from '../../utils/overlayLayers.ts';

const notificationStore = useNotificationStore();
</script>

<template>
  <!-- Teleported and on the `confirm` layer for the same reason as
       ConfirmModal: an alert has to be readable above whatever raised it. -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="notificationStore.modal.visible"
        class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
        :style="{ zIndex: OVERLAY_LAYERS.confirm }"
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
  </Teleport>
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
