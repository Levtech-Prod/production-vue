<template>
  <!-- Only the *Projects* card takes a click: selecting a project is what
       opens the Parts table below the board, and that belongs to the column
       that owns the project rather than to every copy of its card. -->
  <BoardCardShell
    :project-id="project.id"
    :clickable="primary"
    :selected="selected"
    :dimmed="dimmed"
    :grayscale="project.status === 'stopped'"
    @activate="emit('select')"
  >
    <div class="flex items-start gap-1">
      <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
        {{ project.name }}
      </span>

      <span v-if="primary" class="badge shrink-0" :class="STATUS_BADGE[project.status]">
        {{ t(`project_status.${project.status}`) }}
      </span>

      <!-- Stops the click here: the menu is its own control, and letting its
           click reach the card would toggle selection every time it opens. -->
      <ProjectCardMenu
        v-if="primary && hasCardActions(project.status)"
        :status="project.status"
        @click.stop
        @edit="emit('edit')"
        @start="emit('start')"
        @delete="emit('delete')"
        @stop="emit('stop')"
      />
    </div>

    <ul v-if="project.products.length" class="mt-2 space-y-0.5">
      <li v-for="product in visibleProducts" :key="product.projectProductId">
        <div class="flex items-baseline gap-2 text-xs text-slate-500">
          <span class="min-w-0 flex-1 truncate" :title="`${product.name} · ${product.sku}`">
            {{ product.name }}
            <span class="text-slate-400">{{ product.revisionLabel }}</span>
          </span>
          <span class="shrink-0 tabular-nums">× {{ product.quantity }}</span>

          <!-- *Prepared* only: how much of this product is done. Plain text,
               not a control — the sub-products behind the figure are listed
               below rather than hidden behind a click on it. -->
          <span
            v-if="productProgress"
            class="shrink-0 font-semibold tabular-nums text-emerald-600"
          >
            {{ preparedPercent(product) }}%
          </span>
        </div>
      </li>
    </ul>

    <button
      v-if="project.products.length > PREVIEW_COUNT"
      type="button"
      class="mt-1 text-xs font-medium text-blue-600 hover:underline"
      @click.stop="productsExpanded = !productsExpanded"
    >
      {{
        productsExpanded
          ? t('show_less')
          : t('show_n_more', { n: project.products.length - PREVIEW_COUNT })
      }}
    </button>

    <!-- What is already prepared, named rather than merely counted — and the
         only place a mark made by mistake can be taken back, so it is always
         on the card rather than behind a click nothing announced. -->
    <div
      v-if="productProgress && preparedSubProducts.length"
      class="mt-2 border-t border-slate-100 pt-2"
    >
      <ul class="space-y-0.5">
        <li
          v-for="{ product, subProduct } in visiblePreparedSubProducts"
          :key="`${subProduct.projectProductId}-${subProduct.subProductRevisionId}`"
          class="flex items-center gap-1.5 text-[11px]"
        >
          <Check class="h-3 w-3 shrink-0 text-emerald-500" />
          <span
            class="min-w-0 flex-1 truncate text-slate-600"
            :title="`${product.name} · ${subProduct.name} ${subProduct.revisionLabel}`"
          >
            {{ subProduct.name }}
            <span class="text-slate-400">{{ subProduct.revisionLabel }}</span>
            <span class="text-slate-400">· {{ product.sku }}</span>
          </span>
          <button
            type="button"
            class="shrink-0 font-medium text-blue-600 hover:underline"
            @click.stop="emit('unprepare', product, subProduct)"
          >
            {{ t('undo') }}
          </button>
        </li>
      </ul>

      <button
        v-if="preparedSubProducts.length > PREVIEW_COUNT"
        type="button"
        class="mt-1 text-xs font-medium text-blue-600 hover:underline"
        @click.stop="preparedExpanded = !preparedExpanded"
      >
        {{
          preparedExpanded
            ? t('show_less')
            : t('show_n_more', { n: preparedSubProducts.length - PREVIEW_COUNT })
        }}
      </button>
    </div>

    <div
      v-if="badgeKey || project.deadline"
      class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <!-- The column's own count, so a project visibly progresses even while
           *Prepared* stays dark (§4.1). -->
      <span v-if="badgeKey" class="badge bg-slate-100 text-slate-600">
        {{ t(badgeKey, { n: badge ?? 0 }) }}
      </span>
      <span v-if="project.deadline" class="inline-flex items-center gap-1 text-xs text-slate-400">
        <CalendarDays class="h-3.5 w-3.5" />
        {{ formatDate(project.deadline) }}
      </span>
    </div>

    <!-- Whole-project preparation progress, on the project's home card only,
         counted in sub-products — the same fraction the *Preparation* cards
         and the *Prepared* percentages show, so taking a mark back moves all
         three together. A project with nothing frozen has not started, which
         is a different thing from 0% of its work being done: saying "0%"
         there reads as a stalled project rather than one that has not begun. -->
    <div v-if="primary" class="mt-2.5">
      <div
        class="h-1.5 overflow-hidden rounded-full bg-slate-100"
        :title="
          started
            ? t('n_sub_products_prepared_of', { done: preparedCount, total: subProductCount })
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
  </BoardCardShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarDays, Check } from 'lucide-vue-next';
import ProjectCardMenu, { hasCardActions } from './ProjectCardMenu.vue';
import BoardCardShell from './BoardCardShell.vue';
import { preparedPercent } from './columns.ts';
import { formatDate } from '../../../utils/formatters.ts';
import type {
  ProjectBoardCard,
  ProjectBoardProduct,
  ProjectBoardSubProduct,
  ProjectStatus,
} from '../../../types/projects.ts';

const props = defineProps<{
  project: ProjectBoardCard;
  /** The *Projects* column tile — the project's home card, and the only one
   *  that carries its status, its actions and its progress. */
  primary?: boolean;
  /** i18n key for the column's count badge, taking `{ n }`. Omitted on the
   *  *Projects* column, whose count is the product list above. */
  badgeKey?: string;
  badge?: number;
  /** The *Prepared* column tile: each product gains the share of it that is
   *  prepared, and the sub-products behind those figures are listed with a
   *  way to take each mark back. */
  productProgress?: boolean;
  selected?: boolean;
  dimmed?: boolean;
}>();

const emit = defineEmits<{
  select: [];
  edit: [];
  start: [];
  delete: [];
  stop: [];
  unprepare: [product: ProjectBoardProduct, subProduct: ProjectBoardSubProduct];
}>();

const { t } = useI18n();

/** How many rows either list shows before it needs asking. One number, because
 *  the two lists sit on the same card and a card a few hundred pixels wide
 *  cannot afford a different answer for each. */
const PREVIEW_COUNT = 3;

const productsExpanded = ref(false);

const visibleProducts = computed(() =>
  productsExpanded.value
    ? props.project.products
    : props.project.products.slice(0, PREVIEW_COUNT),
);

const preparedExpanded = ref(false);

/** The prepared sub-products, each with the product it sits under — which the
 *  Undo action needs, and which tells two similarly named sub-products apart
 *  on a project that builds more than one thing. */
const preparedSubProducts = computed(() =>
  props.project.subProducts.flatMap((subProduct) => {
    if (!subProduct.prepared) return [];
    const product = props.project.products.find(
      (prod) => prod.projectProductId === subProduct.projectProductId,
    );
    return product ? [{ product, subProduct }] : [];
  }),
);

const visiblePreparedSubProducts = computed(() =>
  preparedExpanded.value
    ? preparedSubProducts.value
    : preparedSubProducts.value.slice(0, PREVIEW_COUNT),
);

/** A project only has frozen sub-products from Start onwards (plan §7 step 8). */
const subProductCount = computed(() => props.project.subProducts.length);
const started = computed(() => subProductCount.value > 0);

const preparedCount = computed(
  () => props.project.subProducts.filter((sub) => sub.prepared).length,
);

const donePercent = computed(() =>
  started.value ? Math.round((preparedCount.value / subProductCount.value) * 100) : 0,
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
