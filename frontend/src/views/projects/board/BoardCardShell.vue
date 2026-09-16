<template>
  <!-- The left edge carries the project's own colour, so the same project is
       recognisable wherever it appears across the five columns — including on
       the *Preparation* cards, which are its sub-products rather than the
       project itself. Seeded by id, not randomised or stored: a colour that
       changes between renders identifies nothing, and ids being sequential
       means ten projects in a row are ten different hues. The inline style
       wins over whichever border class the selection state sets, which is why
       selection reads on the other three sides and the ring. -->
  <div
    class="rounded-lg border border-l-4 bg-white p-2.5 shadow-sm transition-all"
    :class="[
      clickable ? 'cursor-pointer' : '',
      selected
        ? 'border-blue-500 ring-2 ring-blue-100'
        : ['border-slate-200', clickable ? 'hover:border-slate-300' : ''],
      dimmed ? 'opacity-60' : '',
      grayscale ? 'grayscale' : '',
    ]"
    :style="{ borderLeftColor: cardAccent(projectId).stroke }"
    @click="clickable && emit('activate')"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { cardAccent } from '../../../utils/cardAccent.ts';

/** The frame every board card shares: the project's accent, the selection
 *  ring, the dimming a selection puts on the rest, and the click. Extracted
 *  when *Preparation* grew its own card — the frame is one decision about what
 *  a card on this board looks like, not two that happen to match.
 *
 *  What the click DOES is the caller's business, which is why the event is
 *  `activate`: on a *Projects* card it selects the project, on a *Preparation*
 *  card it opens that sub-product's pick list, and on the other three columns
 *  there is nothing to do, so the card is not clickable at all. */
defineProps<{
  /** Seeds the accent colour, so a sub-product card matches its project. */
  projectId: number;
  /** Without this the card takes no click and shows no pointer — a card that
   *  looks clickable and does nothing is worse than a plain tile. */
  clickable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  /** A stopped project reads as inactive wherever it appears. */
  grayscale?: boolean;
}>();

const emit = defineEmits<{ activate: [] }>();
</script>
