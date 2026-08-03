<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @mousedown.self="$emit('update:modelValue', false)"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50 backdrop-blur-[1px]" />

        <!-- Panel -->
        <div
          class="relative z-10 flex flex-col rounded-2xl bg-white shadow-2xl w-full max-h-[90vh]"
          :class="maxWidthClass"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0"
          >
            <h2 class="text-lg font-semibold text-slate-800">{{ title }}</h2>
            <button
              type="button"
              class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              @click="$emit('update:modelValue', false)"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Scrollable body -->
          <div class="flex-1 overflow-y-auto px-6 py-5">
            <slot />
          </div>

          <!-- Footer -->
          <div
            v-if="$slots.footer"
            class="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 shrink-0"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
  }>(),
  { size: 'lg' },
);

defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const maxWidthClass = computed(
  () =>
    ({
      sm: 'max-w-md',
      md: 'max-w-xl',
      lg: 'max-w-3xl',
      xl: 'max-w-6xl',
    })[props.size],
);
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: translateY(8px);
  opacity: 0;
}
</style>
