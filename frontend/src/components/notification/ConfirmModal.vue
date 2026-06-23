<script setup lang="ts">
defineProps<{
  visible: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 class="mb-3 text-lg font-semibold text-gray-900">
          {{ title || 'Megerősítés' }}
        </h3>

        <p class="mb-6 text-sm text-gray-600">
          {{ message || 'Biztosan végrehajtod ezt a műveletet?' }}
        </p>

        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            :disabled="loading"
            @click="$emit('cancel')"
          >
            {{ cancelText || 'Mégse' }}
          </button>

          <button
            type="button"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            :disabled="loading"
            @click="$emit('confirm')"
          >
            {{ loading ? 'Folyamatban...' : confirmText || 'Törlés' }}
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
