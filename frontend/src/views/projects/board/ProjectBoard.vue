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
      @open="emit('open', $event)"
      @prepare="emit('prepare', $event)"
      @unprepare="emit('unprepare', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import ProjectBoardColumn from './ProjectBoardColumn.vue';
import {
  BOARD_COLUMNS,
  type BoardCard,
  type BoardColumn,
  type SubProductTarget,
} from './columns.ts';
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
  open: [target: SubProductTarget];
  prepare: [target: SubProductTarget];
  unprepare: [target: SubProductTarget];
}>();

// The *Projects* column is every project, always (decision 2 — the column
// is a fact about the data, and it is the only one with per-card actions).
// The four derived columns instead narrow to the selection: with a project
// selected, a card belongs on the board only if it *is* that project, so an
// unrelated card is hidden rather than merely dimmed. Nothing is selected ->
// every member card shows, same as *Projects*.
//
// How many cards a project then puts in the column is the column's own
// business: one everywhere but *Preparation*, which splits it per sub-product.
function cardsIn(column: BoardColumn): BoardCard[] {
  const visible =
    column.key === 'projects' || props.selectedId == null
      ? props.projects
      : props.projects.filter((project) => project.id === props.selectedId);
  return visible.flatMap((project) => column.cards(project));
}
</script>
