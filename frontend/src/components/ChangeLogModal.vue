<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="$emit('update:modelValue', false)"
      >
        <div
          class="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col"
          style="max-height: 85vh;"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 shrink-0"
          >
            <div class="min-w-0">
              <h2 class="font-semibold text-slate-900 leading-tight">
                {{ t('change_log') }}
              </h2>
              <p v-if="title" class="text-xs text-slate-400 truncate">{{ title }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              @click="$emit('update:modelValue', false)"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Body: mount fresh each open so the log is always current -->
          <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
            <ChangeLogTable
              v-if="modelValue"
              :entity-type="entityType"
              :entity-id="entityId"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import ChangeLogTable from './ChangeLogTable.vue';

defineProps<{
  modelValue: boolean;
  entityType: string;
  entityId: number;
  title?: string;
}>();

defineEmits<{ 'update:modelValue': [value: boolean] }>();

const { t } = useI18n();
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
