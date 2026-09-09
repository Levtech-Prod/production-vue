<template>
  <section class="flex min-h-0 min-w-0 flex-col">
    <header
      class="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2.5"
    >
      <span class="h-2 w-2 shrink-0 rounded-full" :class="column.dotClass" />
      <h3 class="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ t(column.titleKey) }}
      </h3>
      <span class="badge ml-auto shrink-0 bg-slate-100 text-slate-500">{{ cards.length }}</span>
    </header>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      <p v-if="cards.length === 0" class="px-1 py-8 text-center text-xs text-slate-400">
        {{ t(column.emptyKey) }}
      </p>
      <ProjectCard
        v-for="card in cards"
        :key="card.project.id"
        :project="card.project"
        :primary="column.key === 'projects'"
        :badge-key="column.badgeKey"
        :badge="card.badge"
        :selected="card.project.id === selectedId"
        :dimmed="selectedId != null && card.project.id !== selectedId"
        @select="emit('select', card.project.id)"
        @edit="emit('edit', card.project)"
        @start="emit('start', card.project)"
        @delete="emit('delete', card.project)"
        @stop="emit('stop', card.project)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ProjectCard from './ProjectCard.vue';
import type { BoardColumn, BoardCard } from './columns.ts';
import type { ProjectBoardCard } from '../../../types/projects.ts';

defineProps<{
  column: BoardColumn;
  cards: BoardCard[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
  edit: [project: ProjectBoardCard];
  start: [project: ProjectBoardCard];
  delete: [project: ProjectBoardCard];
  stop: [project: ProjectBoardCard];
}>();

const { t } = useI18n();
</script>
