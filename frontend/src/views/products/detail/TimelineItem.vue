<template>
  <li class="relative">
    <!-- Rail: dot plus the line down to the next entry. The line is hidden on
         the last item so the timeline ends cleanly. -->
    <span
      v-if="!isLast"
      class="absolute left-[13px] top-5 bottom-0 w-px bg-slate-200"
      aria-hidden="true"
    />

    <button
      type="button"
      class="relative flex w-full items-start gap-2 rounded-r-md border-l-2 py-2 pl-2 pr-2 text-left transition-colors"
      :class="
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'
      "
      :aria-current="isSelected ? 'true' : undefined"
      @click="emit('select')"
    >
      <span
        class="mt-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
        :class="dotClass"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span
            class="truncate text-sm font-semibold"
            :class="isSelected ? 'text-blue-700' : 'text-slate-800'"
          >
            {{ title }}
          </span>
          <!-- Between the title and the status badge — a pin, a star, anything
               that qualifies the entry itself. -->
          <slot name="title-badge" />
          <span
            class="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            :class="badgeClass"
          >
            {{ badgeLabel }}
          </span>
        </span>

        <span class="mt-0.5 block truncate text-[11px] text-slate-400">{{ meta }}</span>

        <!-- Extra lines under the meta row, e.g. an attachment count. -->
        <slot name="footer" />
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
/**
 * One entry in a vertical timeline: status dot on a rail, title, status badge,
 * and a muted meta line. Shared by the product revision timeline and the
 * firmware change log, which had byte-identical markup and differed only in
 * what they hang off the two slots.
 *
 * Colours come in as classes rather than a status value: the two timelines use
 * different status vocabularies (draft/active/deprecated vs
 * testing/production/deprecated) and deliberately different palettes for them.
 */
defineProps<{
  title: string;
  /** Background class for the rail dot, e.g. 'bg-emerald-500'. */
  dotClass: string;
  /** Background + text classes for the status badge. */
  badgeClass: string;
  badgeLabel: string;
  /** Muted line under the title — typically date · author. */
  meta: string;
  isSelected: boolean;
  isLast: boolean;
}>();

const emit = defineEmits<{ (e: 'select'): void }>();
</script>
