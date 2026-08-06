<template>
  <BaseModal v-model="open" :title="t('link_document_title', { card: cardName })" size="md">
    <div class="flex flex-col gap-3">
      <p class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
        {{ t('link_document_explainer') }}
      </p>

      <p v-if="loading" class="py-6 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </p>

      <p v-else-if="revisions.length === 0" class="py-6 text-center text-sm text-slate-400">
        {{ t('link_document_empty') }}
      </p>

      <!-- Grouped by source revision — how the user thinks about it. -->
      <div v-else class="flex flex-col gap-4">
        <section v-for="rev in revisions" :key="rev.revisionId" class="flex flex-col gap-1">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {{ rev.revisionLabel }}
          </h3>

          <ul class="flex flex-col divide-y divide-slate-100">
            <li
              v-for="file in rev.files"
              :key="file.id"
              class="flex items-center gap-3 py-2"
              :class="file.alreadyLinked ? 'opacity-50' : ''"
            >
              <FileText class="h-4 w-4 shrink-0 text-slate-400" />

              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-slate-700" :title="file.originalName">
                  {{ file.originalName }}
                </p>
                <p class="text-xs text-slate-400">
                  {{ formatBytes(file.sizeBytes) }} &middot; {{ formatDate(file.createdAt) }}
                </p>
              </div>

              <span
                v-if="file.alreadyLinked"
                class="shrink-0 text-xs text-slate-400"
              >
                {{ t('link_document_already') }}
              </span>
              <button
                v-else
                type="button"
                class="btn-secondary shrink-0 text-xs"
                :disabled="busy"
                @click="emit('link', file.id)"
              >
                {{ t('link_document_use') }}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('close') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { FileText } from 'lucide-vue-next';
import BaseModal from '../../../../components/modal/BaseModal.vue';
import { formatBytes, formatDate } from '../../../../utils/formatters.ts';
import type { LinkableRevision } from '../../../../types/products.ts';

defineProps<{
  /** The card the picked file will be filed under, for the title. */
  cardName: string;
  revisions: LinkableRevision[];
  loading: boolean;
  /** In flight — don't let a double click send two. */
  busy: boolean;
}>();

const emit = defineEmits<{ (e: 'link', sourceDocumentId: number): void }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });
</script>
