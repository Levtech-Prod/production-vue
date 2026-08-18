<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { OVERLAY_LAYERS } from '../../utils/overlayLayers.ts';

defineProps<{
  visible: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  /** Colour of the confirm button. Defaults to the destructive red this
   *  dialog was written for; 'primary' is for confirming a plain save. */
  variant?: 'danger' | 'primary';
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <!-- Teleported so ancestor stacking contexts can't trap it, and on the
       `confirm` layer so it sits in front of whatever it is confirming — e.g.
       replacing a file from inside the document file-list modal. -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
        :style="{ zIndex: OVERLAY_LAYERS.confirm }"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h3 class="mb-3 text-lg font-semibold text-gray-900">
            {{ title || t('confirm') }}
          </h3>

          <p class="mb-6 whitespace-pre-line text-sm text-gray-600">
            {{ message || t('confirmations.action_msg') }}
          </p>

          <div class="flex justify-end gap-3">
            <button
              type="button"
              class="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              :disabled="loading"
              @click="$emit('cancel')"
            >
              {{ cancelText || t('cancel') }}
            </button>

            <button
              type="button"
              class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              :class="
                variant === 'primary'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-red-600 hover:bg-red-700'
              "
              :disabled="loading"
              @click="$emit('confirm')"
            >
              {{ loading ? t('in-progress') : confirmText || t('delete') }}
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
