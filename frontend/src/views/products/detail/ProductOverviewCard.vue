<template>
  <div>
    <!-- Archived banner -->
    <div
      v-if="isArchived"
      class="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <Archive class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <span>{{ t('archived_product_banner') }}</span>
    </div>

    <!-- Info bar -->
    <div class="card p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        <img
          v-if="detail.image"
          :src="detail.image"
          class="h-24 w-24 shrink-0 rounded-xl border border-slate-200 object-cover"
          :alt="detail.name"
        />
        <div
          v-else
          class="grid h-24 w-24 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-2xl text-slate-300"
        >
          ▣
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold">{{ detail.name }}</h1>
            <button
              type="button"
              class="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
              :title="t('change_log')"
              @click="emit('show-history')"
            >
              <Clock class="h-4 w-4" />
            </button>
          </div>
          <div class="font-mono text-sm text-slate-500">{{ detail.sku }}</div>
          <p v-if="detail.description" class="mt-2 text-sm text-slate-500">
            {{ detail.description }}
          </p>
        </div>

        <!-- ── Product revisions (radio switch). Editing, setting the
             default, adding/composing revisions all live in the left
             tree's Revisions mode instead. ── -->
        <div
          ref="revisionsRoot"
          class="relative w-full shrink-0 border-t border-slate-100 pt-4 lg:w-72 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0"
        >
          <h2
            class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 lg:text-right"
          >
            {{ t('product_revisions_title') }}
          </h2>
          <div class="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              v-for="rev in pinnedRevisions"
              :key="rev.id"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors"
              :class="pillClass(rev.id)"
              @click="emit('set-active-revision', rev.id)"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="rev.id === activeProductRevId ? 'bg-white' : 'bg-slate-400'"
              />
              {{ rev.label }}
              <Star
                v-if="rev.id === detail.defaultRevisionId"
                class="h-3 w-3 fill-current"
                :title="t('default_revision')"
              />
            </button>

            <!-- Everything past the pinned few. A product can accumulate
                 dozens of revisions; rendering them all pushes the rest of
                 the page below the fold. -->
            <button
              v-if="overflowRevisions.length"
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
              :aria-expanded="moreOpen"
              @click="moreOpen = !moreOpen"
            >
              {{ t('more_revisions', { n: overflowRevisions.length }) }}
              <ChevronDown class="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            v-if="moreOpen"
            class="absolute right-0 z-20 mt-2 max-h-64 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
            @keydown.escape="moreOpen = false"
          >
            <button
              v-for="rev in overflowRevisions"
              :key="rev.id"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
              :class="
                rev.id === activeProductRevId
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50'
              "
              @click="selectFromOverflow(rev.id)"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                :class="statusDot(rev.status)"
              />
              <span class="min-w-0 flex-1 truncate">{{ rev.label }}</span>
              <span class="shrink-0 text-[10px] text-slate-400">
                {{ t(`revision_status.${rev.status}`) }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <dl
        class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('type') }}</dt>
          <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.type || '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('revisions') }}</dt>
          <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.revisions.length }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('sub_products') }}</dt>
          <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.subProducts.length }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">
            {{ t('default_revision') }}
          </dt>
          <dd class="mt-0.5 flex items-center gap-1 font-semibold text-slate-800">
            <Star
              v-if="defaultRevisionLabel !== '—'"
              class="h-3.5 w-3.5 fill-amber-400 text-amber-400"
            />
            {{ defaultRevisionLabel }}
          </dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('created_at') }}</dt>
          <dd class="mt-0.5 font-semibold text-slate-800">{{ formatDate(detail.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('last_updated') }}</dt>
          <dd class="mt-0.5 font-semibold text-slate-800">{{ formatDate(detail.updatedAt) }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Archive, ChevronDown, Star, Clock } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../utils/formatters.ts';
import { pinnedOrder } from './revisionHelpers.ts';
import { statusDot } from '../../../utils/statusColors.ts';
import type { ProductDetail } from '../../../types/products.ts';

/** How many revisions stay visible; the rest move into the "more" popover. */
const PILL_LIMIT = 4;

const props = defineProps<{
  detail: ProductDetail;
  activeProductRevId: number | null;
  defaultRevisionLabel: string;
  isArchived: boolean;
}>();

const emit = defineEmits<{
  (e: 'set-active-revision', id: number): void;
  (e: 'show-history'): void;
}>();

const { t } = useI18n();

const moreOpen = ref(false);
const revisionsRoot = ref<HTMLElement | null>(null);

// Default revision first, then newest — the two a user reaches for most.
const orderedRevisions = computed(() =>
  pinnedOrder(props.detail.revisions, props.detail.defaultRevisionId),
);

const pinnedRevisions = computed(() => {
  const ordered = orderedRevisions.value;
  // With one over the limit, showing it beats a "+1 more" button.
  if (ordered.length <= PILL_LIMIT + 1) return ordered;
  const head = ordered.slice(0, PILL_LIMIT);
  // The active revision must stay visible even when it lives in the overflow,
  // otherwise the selected pill silently disappears.
  const active = ordered.find((r) => r.id === props.activeProductRevId);
  if (active && !head.some((r) => r.id === active.id)) head[PILL_LIMIT - 1] = active;
  return head;
});

const overflowRevisions = computed(() => {
  const shown = new Set(pinnedRevisions.value.map((r) => r.id));
  return orderedRevisions.value.filter((r) => !shown.has(r.id));
});

function selectFromOverflow(revId: number) {
  emit('set-active-revision', revId);
  moreOpen.value = false;
}

function pillClass(revId: number): string {
  return revId === props.activeProductRevId
    ? 'border-blue-500 bg-blue-600 text-white'
    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';
}

function onDocumentClick(event: MouseEvent) {
  if (
    moreOpen.value &&
    revisionsRoot.value &&
    !revisionsRoot.value.contains(event.target as Node)
  ) {
    moreOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
