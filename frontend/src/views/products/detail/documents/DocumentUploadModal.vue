<template>
  <BaseModal v-model="open" :title="t('upload_document')" size="sm">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-slate-500">{{ t('document_name_hint') }}</p>
      <div
        v-if="file"
        class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
      >
        <FileText class="h-4 w-4 shrink-0 text-slate-400" />
        <span class="truncate">{{ file.name }}</span>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-500">
          {{ t('document_name') }}
        </label>
        <input
          v-model="name"
          type="text"
          class="input"
          :placeholder="file?.name || ''"
          @keyup.enter="emit('confirm')"
        />
      </div>
    </div>
    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="button" class="btn-primary" :disabled="uploading" @click="emit('confirm')">
        {{ uploading ? t('uploading') : t('upload_document') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { FileText } from 'lucide-vue-next';
import BaseModal from '../../../../components/modal/BaseModal.vue';

defineProps<{
  file: File | null;
  uploading: boolean;
}>();

const emit = defineEmits<{ (e: 'confirm'): void }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });
const name = defineModel<string>('name', { default: '' });
</script>
