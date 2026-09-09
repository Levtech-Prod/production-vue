<template>
  <!-- The five columns share the width rather than scrolling sideways:
       `min-w-0` on each column is what lets them shrink instead of forcing
       the row wider than the screen. They stay a board down to `lg`, which
       covers every laptop width; below that five columns are too narrow to
       read, so they stack, the dividers turn with them, and the whole grid
       scrolls instead of each column.
       `grid-rows-[minmax(0,1fr)]` pins the single row to the board's height
       so a full column scrolls inside itself rather than growing past the
       card, which would clip it. -->
  <div
    class="grid min-h-0 divide-y divide-slate-200 overflow-y-auto lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:divide-x lg:divide-y-0 lg:overflow-hidden"
  >
    <ProjectBoardColumn
      v-for="column in BOARD_COLUMNS"
      :key="column.key"
      :column="column"
      :cards="cardsIn(column)"
      :selected-id="selectedId"
      @select="emit('select', $event)"
      @edit="emit('edit', $event)"
      @start="emit('start', $event)"
      @delete="emit('delete', $event)"
      @stop="emit('stop', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import ProjectBoardColumn from './ProjectBoardColumn.vue';
import { BOARD_COLUMNS, type BoardCard, type BoardColumn } from './columns.ts';
import type { ProjectBoardCard } from '../../../types/projects.ts';

const props = defineProps<{
  projects: ProjectBoardCard[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
  edit: [project: ProjectBoardCard];
  start: [project: ProjectBoardCard];
  delete: [project: ProjectBoardCard];
  stop: [project: ProjectBoardCard];
}>();

function cardsIn(column: BoardColumn): BoardCard[] {
  return props.projects
    .filter(column.member)
    .map((project) => ({ project, badge: column.badge(project) }));
}
</script>
