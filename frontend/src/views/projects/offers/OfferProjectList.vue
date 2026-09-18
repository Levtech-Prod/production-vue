<template>
  <div
    class="card flex min-h-0 shrink-0 flex-col overflow-hidden transition-[width]"
    :class="collapsed ? 'w-11' : 'w-60'"
  >
    <div
      class="flex shrink-0 items-center gap-2 border-b border-slate-100 py-3"
      :class="collapsed ? 'justify-center px-1' : 'px-3'"
    >
      <template v-if="!collapsed">
        <h2 class="truncate text-sm font-semibold text-slate-700">
          {{ t('project_column.offers') }}
        </h2>
        <span class="ml-auto text-sm text-slate-400">
          {{ loading ? t('loading') : projects.length }}
        </span>
      </template>

      <button
        type="button"
        class="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        :title="collapsed ? t('expand_offer_list') : t('collapse_offer_list')"
        @click="ui.toggleOfferList()"
      >
        <PanelLeftOpen v-if="collapsed" class="h-4 w-4" />
        <PanelLeftClose v-else class="h-4 w-4" />
      </button>
    </div>

    <!-- Collapsed, the panel is a handle and a count: enough to say the list
         is still there and how much is in it, without the width. -->
    <div v-if="collapsed" class="flex flex-1 justify-center pt-3">
      <span class="text-xs font-semibold tabular-nums text-slate-400 [writing-mode:vertical-rl]">
        {{ t('project_column.offers') }} · {{ projects.length }}
      </span>
    </div>

    <div v-else class="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
      <p v-if="!loading && projects.length === 0" class="px-2 py-8 text-center text-sm text-slate-400">
        {{ t('no_offer_projects_msg') }}
      </p>

      <!-- The same frame the board's cards use, so a project is the same tile
           and the same colour on both pages (`BoardCardShell`'s own note).
           `ProjectCard` itself does not fit: it renders a `ProjectBoardCard`'s
           products, sub-products and progress, none of which the offer queue
           carries or a buyer picking a project to quote needs. -->
      <BoardCardShell
        v-for="project in projects"
        :key="project.id"
        :project-id="project.id"
        clickable
        :selected="project.id === selectedId"
        :dimmed="selectedId !== null && project.id !== selectedId"
        @activate="emit('select', project.id)"
      >
        <div class="truncate text-sm font-semibold text-slate-800" :title="project.name">
          {{ project.name }}
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="badge bg-slate-100 text-slate-600">
            {{ t('to_buy_lines', { n: project.toBuyLines }) }}
          </span>
          <span v-if="project.onOrderLines > 0" class="badge bg-blue-50 text-blue-700">
            {{ t('on_order_lines', { n: project.onOrderLines }) }}
          </span>
          <span
            v-if="project.deadline"
            class="inline-flex items-center gap-1 text-xs text-slate-400"
          >
            <CalendarDays class="h-3.5 w-3.5" />
            {{ formatDate(project.deadline) }}
          </span>
        </div>
      </BoardCardShell>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarDays, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next';
import BoardCardShell from '../board/BoardCardShell.vue';
import { useUiStore } from '../../../stores/uiStore.ts';
import { formatDate } from '../../../utils/formatters.ts';
import type { OfferQueueProject } from '../../../types/projectOffers.ts';

/**
 * The list down the left of the Offer Processing page (§6.5): every project
 * with at least one line still to buy, newest first, single-select.
 *
 * The list is the parent's state, not this component's — the grid's writes
 * move the line counts on these entries, so whoever holds both has to hold the
 * list too. The collapsed/expanded width is this component's, and lives in
 * `uiStore` so it survives navigation.
 */
defineProps<{
  projects: OfferQueueProject[];
  selectedId: number | null;
  loading: boolean;
}>();

const emit = defineEmits<{ select: [id: number] }>();

const { t } = useI18n();
const ui = useUiStore();

const collapsed = computed(() => ui.offerListCollapsed);
</script>
