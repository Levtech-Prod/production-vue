<template>
  <BoardCardShell
    :project-id="project.id"
    clickable
    :dimmed="dimmed"
    :grayscale="project.status === 'stopped'"
    @activate="emit('open')"
  >
    <p class="truncate text-sm font-semibold text-slate-800" :title="project.name">
      {{ project.name }}
    </p>
    <!-- The main product, under the project name: a sub-product's own name
         ("Base rev A") says nothing about what it is being built for, and one
         project can be preparing the same sub-product under two products. -->
    <p class="truncate text-xs text-slate-500" :title="`${product.name} · ${product.sku}`">
      {{ product.name }}
      <span class="text-slate-400">{{ product.revisionLabel }}</span>
    </p>

    <div class="mt-2 rounded-md bg-slate-50 px-2 py-1.5">
      <p
        class="truncate text-sm font-medium text-slate-700"
        :title="subProduct.sku ? `${subProduct.name} · ${subProduct.sku}` : subProduct.name"
      >
        {{ subProduct.name }}
        <span class="text-xs font-normal text-slate-400">{{ subProduct.revisionLabel }}</span>
      </p>
      <p class="mt-0.5 text-xs" :class="ready ? 'text-emerald-600' : 'text-slate-500'">
        {{
          t('n_pieces_picked_of', {
            picked: subProduct.pickedQty,
            total: subProduct.requiredQty,
          })
        }}
      </p>
      <!-- Kept beside the pick count rather than replacing it: what is ticked
           off is the person's own progress, what is short is the reason the
           rest of the list is stuck. -->
      <p v-if="shortPartCount > 0" class="mt-0.5 text-xs text-amber-600">
        {{ t('n_parts_not_in_stock', { n: shortPartCount }) }}
      </p>
    </div>

    <!-- Stops the click here: the button is its own control, and letting its
         click reach the card would toggle selection every time it is used. -->
    <button
      type="button"
      class="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
      :class="
        ready
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'cursor-not-allowed bg-slate-100 text-slate-400'
      "
      :disabled="!ready"
      :title="ready ? undefined : t('sub_product_parts_not_picked')"
      @click.stop="emit('prepare')"
    >
      {{ t('mark_prepared') }}
    </button>

    <!-- The product's progress, not this card's: a main product is finished
         one sub-product at a time, and this is the number the *Prepared* card
         shows as a percentage beside the same product. -->
    <div class="mt-2.5">
      <div class="h-1.5 overflow-hidden rounded-full bg-slate-100" :title="progressLabel">
        <div
          v-if="product.preparedSubProducts > 0"
          class="h-full rounded-full bg-emerald-500 transition-[width]"
          :style="{ width: `${preparedPercent(product)}%` }"
        />
      </div>
      <p class="mt-1 text-right text-[11px] tabular-nums text-slate-400">{{ progressLabel }}</p>
    </div>
  </BoardCardShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BoardCardShell from './BoardCardShell.vue';
import { preparedPercent } from './columns.ts';
import type {
  ProjectBoardCard,
  ProjectBoardProduct,
  ProjectBoardSubProduct,
} from '../../../types/projects.ts';

const props = defineProps<{
  project: ProjectBoardCard;
  /** The pinned product this sub-product belongs to. */
  product: ProjectBoardProduct;
  subProduct: ProjectBoardSubProduct;
  dimmed?: boolean;
}>();

const emit = defineEmits<{ open: []; prepare: [] }>();

const { t } = useI18n();

/** The pick list has to be complete: marking is all-or-nothing, and half a
 *  sub-product prepared would put a card in *Prepared* that nobody can build
 *  from. Counted in pieces, which is the same question as "every line full"
 *  because no line may hold more than it needs — and unlike a count of
 *  finished lines, it also moves on a partial pick. */
const ready = computed(() => {
  const { requiredQty, pickedQty } = props.subProduct;
  return requiredQty > 0 && pickedQty === requiredQty;
});

/** Parts the project does not hold enough of yet. */
const shortPartCount = computed(
  () => props.subProduct.partCount - props.subProduct.readyPartCount,
);

const progressLabel = computed(() =>
  t('n_sub_products_prepared_of', {
    done: props.product.preparedSubProducts,
    total: props.product.subProductCount,
  }),
);
</script>
