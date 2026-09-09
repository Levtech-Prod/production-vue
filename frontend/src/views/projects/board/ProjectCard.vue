<template>
  <!-- The left edge carries the project's own colour, so the same project is
       recognisable wherever it appears across the five columns. Seeded by id,
       not randomised or stored — a colour that changes between renders
       identifies nothing, and ids being sequential means ten projects in a row
       are ten different hues. The inline style wins over whichever border
       class the selection state sets, which is why selection reads on the
       other three sides and the ring. -->
  <div
    class="rounded-lg border border-l-4 bg-white p-2.5 shadow-sm transition-all"
    :class="[
      selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300',
      dimmed ? 'opacity-60' : '',
      project.status === 'stopped' ? 'grayscale' : '',
    ]"
    :style="{ borderLeftColor: cardAccent(project.id).stroke }"
  >
    <div class="flex items-start gap-1">
      <!-- Only the tile body selects: the menu beside it is a button of its
           own and must not sit inside another one. -->
      <button
        type="button"
        class="min-w-0 flex-1 text-left"
        @click="emit('select')"
      >
        <span class="block truncate text-sm font-semibold text-slate-800">
          {{ project.name }}
        </span>
      </button>

      <span v-if="primary" class="badge shrink-0" :class="STATUS_BADGE[project.status]">
        {{ t(`project_status.${project.status}`) }}
      </span>

      <ProjectCardMenu
        v-if="primary && hasCardActions(project.status)"
        :status="project.status"
        @edit="emit('edit')"
        @start="emit('start')"
        @delete="emit('delete')"
        @stop="emit('stop')"
      />
    </div>

    <ul v-if="project.products.length" class="mt-2 space-y-0.5">
      <li
        v-for="(product, index) in visibleProducts"
        :key="index"
        class="flex items-baseline gap-2 text-xs text-slate-500"
      >
        <span class="min-w-0 flex-1 truncate" :title="`${product.name} · ${product.sku}`">
          {{ product.name }}
          <span class="text-slate-400">{{ product.revisionLabel }}</span>
        </span>
        <span class="shrink-0 tabular-nums">× {{ product.quantity }}</span>
      </li>
    </ul>

    <button
      v-if="project.products.length > PRODUCT_PREVIEW_COUNT"
      type="button"
      class="mt-1 text-xs font-medium text-blue-600 hover:underline"
      @click="productsExpanded = !productsExpanded"
    >
      {{
        productsExpanded
          ? t('show_less')
          : t('show_n_more', { n: project.products.length - PRODUCT_PREVIEW_COUNT })
      }}
    </button>

    <div
      v-if="badgeKey || project.deadline"
      class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <!-- The column's own count, so a project visibly progresses even while
           *Prepared* stays dark (§4.1). -->
      <span v-if="badgeKey" class="badge bg-slate-100 text-slate-600">
        {{ t(badgeKey, { n: badge ?? 0 }) }}
      </span>
      <span
        v-if="project.deadline"
        class="inline-flex items-center gap-1 text-xs text-slate-400"
      >
        <CalendarDays class="h-3.5 w-3.5" />
        {{ formatDate(project.deadline) }}
      </span>
    </div>

    <!-- Preparation progress, on the project's home card only. A project with
         no frozen lines has not started, which is a different thing from 0%
         of its work being done — saying "0%" there reads as a stalled project
         rather than one that has not begun. -->
    <div v-if="primary" class="mt-2.5">
      <div
        class="h-1.5 overflow-hidden rounded-full bg-slate-100"
        :title="
          started
            ? t('n_lines_ready', { done: project.doneLines, total: project.lineCount })
            : t('progress_not_started')
        "
      >
        <div
          v-if="started"
          class="h-full rounded-full bg-emerald-500 transition-[width]"
          :style="{ width: `${donePercent}%` }"
        />
      </div>
      <p class="mt-1 text-right text-[11px] tabular-nums text-slate-400">
        {{ started ? `${donePercent}%` : t('progress_not_started') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarDays } from 'lucide-vue-next';
import ProjectCardMenu, { hasCardActions } from './ProjectCardMenu.vue';
import { formatDate } from '../../../utils/formatters.ts';
import { cardAccent } from '../../../utils/cardAccent.ts';
import type { ProjectBoardCard, ProjectStatus } from '../../../types/projects.ts';

const props = defineProps<{
  project: ProjectBoardCard;
  /** The *Projects* column tile — the project's home card, and the only one
   *  that carries its status, its actions and its progress. */
  primary?: boolean;
  /** i18n key for the column's count badge, taking `{ n }`. Omitted on the
   *  *Projects* column, whose count is the product list above. */
  badgeKey?: string;
  badge?: number;
  selected?: boolean;
  dimmed?: boolean;
}>();

const emit = defineEmits<{ select: []; edit: []; start: []; delete: []; stop: [] }>();

const { t } = useI18n();

const PRODUCT_PREVIEW_COUNT = 3;

const productsExpanded = ref(false);

const visibleProducts = computed(() =>
  productsExpanded.value
    ? props.project.products
    : props.project.products.slice(0, PRODUCT_PREVIEW_COUNT),
);

/** A project only has frozen lines from Start onwards (plan §7 step 8). */
const started = computed(() => props.project.lineCount > 0);

const donePercent = computed(() =>
  started.value ? Math.round((props.project.doneLines / props.project.lineCount) * 100) : 0,
);

// Deliberately not `utils/statusColors.ts`: that palette maps a revision's
// three lifecycle stages and is shared so they can't drift. A project's four
// states are a different decision that happens to look similar.
const STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  started: 'bg-blue-50 text-blue-700',
  stopped: 'bg-amber-50 text-amber-700',
  completed: 'bg-emerald-50 text-emerald-700',
};
</script>
