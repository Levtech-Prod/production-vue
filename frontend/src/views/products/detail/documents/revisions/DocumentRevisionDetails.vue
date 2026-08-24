<template>
  <div class="min-h-0 overflow-y-auto px-4 py-3">
    <!-- Checked before everything else: on a cache miss the list still holds
         the previously opened card's versions, and rendering one of those here
         put live Edit / Delete / Set-as-production buttons on a version the
         user is no longer looking at. -->
    <p v-if="loading" class="py-10 text-center text-sm text-slate-400">
      {{ t('loading') }}
    </p>

    <!-- Nothing exists yet. Files live INSIDE a version, so this is the one
         place that has to explain the order of operations — without it the
         panel reads as broken rather than empty. -->
    <div v-else-if="!hasRevisions" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
        <component :is="icon" class="h-6 w-6" />
      </span>
      <p class="text-sm font-semibold text-slate-700">{{ t('no_versions_yet') }}</p>
      <p class="max-w-xs text-xs text-slate-500">{{ t('no_versions_yet_hint') }}</p>
      <button
        v-if="canEdit"
        type="button"
        class="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        @click="emit('create')"
      >
        <Plus class="h-4 w-4" /> {{ t('add_first_version') }}
      </button>
    </div>

    <!-- Versions exist but none is selected: the gap between deleting the
         selected version and its refetch landing, and permanently if that
         refetch fails. Filtering does NOT deselect. -->
    <p v-else-if="!revision" class="py-10 text-center text-sm text-slate-400">
      {{ t('select_version_hint') }}
    </p>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h3 class="min-w-0 truncate text-lg font-semibold text-slate-800">
          {{ revision.name }}
        </h3>
        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          :class="statusBadgeClass(revision.status)"
        >
          {{ t(`version_status.${revision.status}`) }}
        </span>

        <div v-if="canEdit" class="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            @click="emit('edit', revision)"
          >
            <Pencil class="h-3.5 w-3.5" /> {{ t('edit') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            @click="emit('delete', revision)"
          >
            <Trash2 class="h-3.5 w-3.5" /> {{ t('delete') }}
          </button>
        </div>
      </div>

      <section class="rounded-xl border border-slate-200">
        <h4 class="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          {{ t('version_info') }}
        </h4>

        <!-- Details left, status box right, a rule between them. The divider is
             a border on the right-hand column rather than a `divide-x`, so it
             disappears with the same breakpoint that stacks the two. -->
        <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-0">
          <dl
            class="grid grid-cols-[8.5rem_minmax(0,1fr)] content-start gap-x-3 gap-y-2.5 text-sm lg:pr-5"
          >
            <dt class="text-slate-500">{{ t('version_name') }}</dt>
            <dd class="min-w-0 truncate font-medium text-slate-800">{{ revision.name }}</dd>

            <dt class="text-slate-500">{{ t('field_status') }}</dt>
            <dd class="flex items-center gap-1.5 text-slate-800">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="statusDot(revision.status)"
                aria-hidden="true"
              />
              {{ t(`version_status.${revision.status}`) }}
            </dd>

            <dt class="text-slate-500">{{ t('version_created_at') }}</dt>
            <dd class="text-slate-800">{{ formatDate(revision.createdAt) }}</dd>

            <dt class="text-slate-500">{{ t('version_created_by') }}</dt>
            <dd class="min-w-0 truncate text-slate-800">{{ revision.createdByName || '—' }}</dd>

            <dt class="text-slate-500">{{ t('version_release_notes') }}</dt>
            <!-- v-text, not an interpolation: `whitespace-pre-wrap` is needed for
                 multi-line notes, and it would otherwise also render this
                 template's own newline and indentation. -->
            <dd
              class="min-w-0 whitespace-pre-wrap break-words"
              :class="revision.releaseNotes ? 'text-slate-800' : 'text-slate-400'"
              v-text="revision.releaseNotes || t('no_release_notes')"
            />
          </dl>

          <div class="lg:border-l lg:border-slate-100 lg:pl-5">
            <!-- Rendered in both states so the pane doesn't jump in height when
                 a version is promoted. -->
            <div
              class="rounded-xl border px-3 py-3"
              :class="
                isProduction ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
              "
            >
              <p class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Crown
                  class="h-4 w-4 shrink-0"
                  :class="isProduction ? 'text-emerald-600' : 'text-slate-400'"
                />
                {{ isProduction ? t('version_is_production') : t('version_not_production') }}
              </p>
              <p class="mt-1.5 text-xs leading-relaxed text-slate-500">
                {{
                  isProduction ? t('version_is_production_hint') : t('version_not_production_hint')
                }}
              </p>
              <button
                v-if="canEdit && !isProduction"
                type="button"
                class="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="saving"
                @click="emit('set-production', revision)"
              >
                {{ t('set_as_production') }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Crown, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../../../utils/formatters.ts';
import { resolveIcon } from '../../../../../utils/documentTypeIcons.ts';
import { statusBadgeClass, statusDot } from '../../../../../utils/statusColors.ts';
import type { DocumentRevision } from '../../../../../types/documentRevisions.ts';

const props = defineProps<{
  revision: DocumentRevision | null;
  /** False means the card has no versions at all, which needs a different
   *  empty state from "none selected". */
  hasRevisions: boolean;
  /** The card's versions are still being fetched, so `revision` may still be
   *  the previously opened card's. */
  loading: boolean;
  /** The card's own icon, so the empty state looks like what you clicked. */
  iconName: string;
  canEdit: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'edit', revision: DocumentRevision): void;
  (e: 'delete', revision: DocumentRevision): void;
  (e: 'set-production', revision: DocumentRevision): void;
}>();

const { t } = useI18n();

const icon = computed(() => resolveIcon(props.iconName));
const isProduction = computed(() => props.revision?.status === 'production');
</script>
